import ExcelJS from "exceljs";
import JSZip from "jszip";

function columnLetter(n: number): string {
  let s = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

/**
 * Реальные выгрузки Ozon (например лист "Товар-склад" в отчёте
 * "Оборачиваемость") не проставляют позиционные ссылки r="N" на <row> и
 * r="A1" на <c> — это валидно по спецификации OOXML (позиция тогда
 * подразумевается последовательной), но exceljs не переживает полное
 * отсутствие этих атрибутов ("Invalid row number in model" /
 * "Cannot read properties of undefined (reading 'col')"). Чиним точечно:
 * если во всём листе НИ у одной строки/ячейки нет r=, проставляем их по
 * порядку следования в документе. Файлы, где ссылки уже есть (как в
 * отчёте "Остатки"), не трогаем вообще.
 */
async function patchMissingReferences(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const sheetPaths = Object.keys(zip.files).filter((name) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  );

  let patchedAny = false;

  for (const path of sheetPaths) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");

    const rowsHaveRefs = /<row\b[^>]*\br=/.test(xml);
    const cellsHaveRefs = /<c\b[^>]*\br=/.test(xml);
    if (rowsHaveRefs && cellsHaveRefs) continue; // уже размечено штатно

    let rowIndex = 0;
    const patched = xml.replace(
      /<row([^>]*)>([\s\S]*?)<\/row>/g,
      (_match, rowAttrs: string, rowBody: string) => {
        rowIndex++;
        const newRowAttrs = rowsHaveRefs ? rowAttrs : ` r="${rowIndex}"${rowAttrs}`;

        let colIndex = 0;
        const newRowBody = cellsHaveRefs
          ? rowBody
          : rowBody.replace(/<c([^>]*)>/g, (_cellMatch: string, cellAttrs: string) => {
              colIndex++;
              return `<c r="${columnLetter(colIndex)}${rowIndex}"${cellAttrs}>`;
            });

        return `<row${newRowAttrs}>${newRowBody}</row>`;
      }
    );

    zip.file(path, patched);
    patchedAny = true;
  }

  if (!patchedAny) return buffer;
  return zip.generateAsync({ type: "nodebuffer" });
}

export type OzonStockRow = {
  vendorCode: string; // "Артикул" — собственный код продавца
  ozonSku: string; // "SKU" — числовой ID Ozon, используем как mpSku для сопоставления
  warehouseName: string; // конкретный региональный склад Ozon (их десятки)
  qty: number;
};

export type OzonParseResult =
  | { format: "turnover_ledger" | "turnover_snapshot"; rows: OzonStockRow[] }
  | { format: "unknown" };

function cellStr(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in (v as any)) return String((v as any).result ?? "").trim();
  return String(v).trim();
}

function cellNum(row: ExcelJS.Row, col: number): number {
  const v = row.getCell(col).value;
  const n = typeof v === "object" && v && "result" in (v as any) ? Number((v as any).result) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Разбор родных xlsx-отчётов Ozon без ручной подготовки. Поддерживаются
 * два реальных формата (проверено на настоящих выгрузках):
 *
 * 1) "Оборотная ведомость" (отчёт "Остатки", один лист) — по строке на
 *    SKU+склад, заголовок на 4-й строке, данные с 5-й. Колонки:
 *    A=SKU, B=Название склада, C=Артикул, D=Название товара, ...,
 *    J=Остаток на конец периода, K=Валидный сток на конец периода,
 *    L=Невалидный сток на конец периода. Берём K (валидный) как остаток —
 *    он уже исключает брак/просрочку.
 *
 * 2) "Товар-склад" (лист внутри отчёта "Оборачиваемость") — многоуровневый
 *    заголовок на первых 4 строках, данные с 5-й. Колонки:
 *    A=Артикул, B=Название товара, C=SKU, ..., G=Склад,
 *    H=Доступно к продаже. Это готовый к использованию текущий остаток.
 *
 * Оба формата не различают FBO/FBS — это всегда остатки на складах Ozon
 * (FBO), FBS-отчётов Ozon не выгружает.
 */
export async function parseOzonStockFile(buffer: Buffer): Promise<OzonParseResult> {
  const safeBuffer = await patchMissingReferences(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(safeBuffer as any);

  const snapshotSheet = workbook.worksheets.find((ws) => ws.name === "Товар-склад");
  if (snapshotSheet) {
    const header = snapshotSheet.getRow(1);
    if (
      cellStr(header, 1) === "Артикул" &&
      cellStr(header, 2) === "Название товара" &&
      cellStr(header, 3) === "SKU" &&
      cellStr(header, 7) === "Склад"
    ) {
      const rows: OzonStockRow[] = [];
      snapshotSheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 4) return; // 4 строки составного заголовка
        const ozonSku = cellStr(row, 3);
        const warehouseName = cellStr(row, 7);
        if (!ozonSku || !warehouseName) return;
        rows.push({
          vendorCode: cellStr(row, 1),
          ozonSku,
          warehouseName,
          qty: cellNum(row, 8), // "Доступно к продаже"
        });
      });
      return { format: "turnover_snapshot", rows };
    }
  }

  for (const sheet of workbook.worksheets) {
    const header = sheet.getRow(4);
    if (
      cellStr(header, 1) === "SKU" &&
      cellStr(header, 2) === "Название склада" &&
      cellStr(header, 3) === "Артикул" &&
      cellStr(header, 10) === "Остаток на конец периода"
    ) {
      const rows: OzonStockRow[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 4) return;
        const ozonSku = cellStr(row, 1);
        const warehouseName = cellStr(row, 2);
        if (!ozonSku || !warehouseName) return;
        rows.push({
          vendorCode: cellStr(row, 3),
          ozonSku,
          warehouseName,
          qty: cellNum(row, 11), // "Валидный сток на конец периода"
        });
      });
      return { format: "turnover_ledger", rows };
    }
  }

  return { format: "unknown" };
}

export type OzonAnalyticsRow = {
  vendorCode: string;
  ozonSku: string;
  name: string;
  liquidityStatus: string | null; // "Дефицитный" | "Избыточный" | "Без продаж" и т.д. — как есть у Ozon
  daysOfStockLeft: number | null; // null — Ozon не посчитал (обычно когда продаж не было)
  avgDailySalesQty: number; // среднесуточные продажи за 28 дней
  daysWithoutSales: number | null;
  qtyAvailable: number;
};

/**
 * Разбор листа "Товары" из отчёта Ozon "Оборачиваемость" — это агрегат
 * по каждому SKU за весь аккаунт (не по складам/кластерам), с готовыми
 * метриками, которые считает сам Ozon: скорость продаж, дней до конца
 * остатка, статус ликвидности. Структура: составной заголовок на первых
 * 4 строках, данные с 5-й. Колонки: A=Артикул, B=Название, C=SKU,
 * F=Статус ликвидности, G=Дней до конца остатка, H=Среднесуточные продажи
 * за 28 дней, I=Дней без продаж, J=Доступно к продаже.
 */
export async function parseOzonAnalyticsFile(buffer: Buffer): Promise<OzonAnalyticsRow[] | null> {
  const safeBuffer = await patchMissingReferences(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(safeBuffer as any);

  const sheet = workbook.worksheets.find((ws) => ws.name === "Товары");
  if (!sheet) return null;

  const header = sheet.getRow(1);
  if (cellStr(header, 1) !== "Артикул" || cellStr(header, 3) !== "SKU") {
    return null;
  }

  const rows: OzonAnalyticsRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 4) return; // 4 строки составного заголовка
    const ozonSku = cellStr(row, 3);
    if (!ozonSku) return;

    const daysOfStockRaw = cellStr(row, 7);
    const daysWithoutSalesRaw = cellStr(row, 9);

    rows.push({
      vendorCode: cellStr(row, 1),
      name: cellStr(row, 2).replace(/ /g, " "),
      ozonSku,
      liquidityStatus: cellStr(row, 6).replace(/ /g, " ") || null,
      daysOfStockLeft: daysOfStockRaw ? Math.round(cellNum(row, 7)) : null,
      avgDailySalesQty: cellNum(row, 8),
      daysWithoutSales: daysWithoutSalesRaw ? Math.round(cellNum(row, 9)) : null,
      qtyAvailable: cellNum(row, 10),
    });
  });

  return rows;
}

export type OzonClusterAnalyticsRow = OzonAnalyticsRow & {
  clusterName: string;
};

/**
 * Разбор листа "Товар-кластер" из отчёта Ozon "Оборачиваемость" — те же
 * метрики, что и в parseOzonAnalyticsFile, но в разрезе по каждому
 * региональному кластеру Ozon отдельно (одна строка на SKU+кластер).
 * Нужно, чтобы находить перекос остатков между регионами: дефицит в одном,
 * избыток в другом, хотя в сумме по аккаунту всё выглядит нормально.
 * Колонки те же, что в листе "Товары", но с добавленной F=Кластер, из-за
 * чего остальные сдвинуты на одну: G=Статус, H=Дней до конца остатка,
 * I=Среднесуточные продажи, J=Дней без продаж, K=Доступно к продаже.
 */
export async function parseOzonClusterAnalyticsFile(
  buffer: Buffer
): Promise<OzonClusterAnalyticsRow[] | null> {
  const safeBuffer = await patchMissingReferences(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(safeBuffer as any);

  const sheet = workbook.worksheets.find((ws) => ws.name === "Товар-кластер");
  if (!sheet) return null;

  const header = sheet.getRow(1);
  if (
    cellStr(header, 1) !== "Артикул" ||
    cellStr(header, 3) !== "SKU" ||
    cellStr(header, 6) !== "Кластер"
  ) {
    return null;
  }

  const rows: OzonClusterAnalyticsRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 4) return; // 4 строки составного заголовка
    const ozonSku = cellStr(row, 3);
    const clusterName = cellStr(row, 6);
    if (!ozonSku || !clusterName) return;

    const daysOfStockRaw = cellStr(row, 8);
    const daysWithoutSalesRaw = cellStr(row, 10);

    rows.push({
      vendorCode: cellStr(row, 1),
      name: cellStr(row, 2).replace(/ /g, " "),
      ozonSku,
      clusterName,
      liquidityStatus: cellStr(row, 7).replace(/ /g, " ") || null,
      daysOfStockLeft: daysOfStockRaw ? Math.round(cellNum(row, 8)) : null,
      avgDailySalesQty: cellNum(row, 9),
      daysWithoutSales: daysWithoutSalesRaw ? Math.round(cellNum(row, 10)) : null,
      qtyAvailable: cellNum(row, 11),
    });
  });

  return rows;
}
