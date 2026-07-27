import ExcelJS from "exceljs";

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

export type YandexStockRow = {
  vendorArticle: string; // "Ваш SKU" — общий ключ между обоими отчётами ЯМ
  qty: number; // "Доступно для заказа", суммарно по всем складам
};

/**
 * Разбор отчёта ЯМ "Остатки на складе" — одна строка на SKU+склад (как у
 * Ozon), поэтому остаток по каждому артикулу суммируем по всем складам.
 * Заголовок на 4-й строке, 5-я — пустая разделительная, данные с 6-й.
 */
export async function parseYandexStockFile(buffer: Buffer): Promise<YandexStockRow[] | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const sheet = workbook.worksheets[0];
  if (!sheet) return null;

  const header = sheet.getRow(4);
  if (
    cellStr(header, 1) !== "SSKU" ||
    cellStr(header, 2) !== "Ваш SKU" ||
    cellStr(header, 7) !== "Доступно для заказа"
  ) {
    return null;
  }

  const totals = new Map<string, number>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 5) return; // заголовок (4 строки не считая доп.строк) + пустая разделительная
    const vendorArticle = cellStr(row, 2);
    if (!vendorArticle) return;
    const qty = cellNum(row, 7);
    totals.set(vendorArticle, (totals.get(vendorArticle) ?? 0) + qty);
  });

  return [...totals.entries()].map(([vendorArticle, qty]) => ({ vendorArticle, qty }));
}

export type YandexAnalyticsRow = {
  vendorArticle: string;
  name: string;
  qtyOrdered: number; // "Заказанные товары, шт."
  revenueOrderedRub: number; // "Заказано товаров на сумму, ₽"
  qtyDelivered: number; // "Доставлено за период, шт."
  revenueDeliveredRub: number; // "Доставлено за период на сумму, ₽"
};

/**
 * Разбор отчёта ЯМ "Аналитика продаж". Заголовок на 1-й строке, данные
 * со 2-й. В отличие от отчёта "Остатки", здесь нет числового SKU ЯМ —
 * только "Ваш SKU", поэтому сопоставляем по нему же, как и в остатках.
 */
export async function parseYandexAnalyticsFile(
  buffer: Buffer
): Promise<YandexAnalyticsRow[] | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const sheet = workbook.worksheets[0];
  if (!sheet) return null;

  const header = sheet.getRow(1);
  if (
    cellStr(header, 1) !== "Категория" ||
    cellStr(header, 3) !== "Ваш SKU" ||
    cellStr(header, 9) !== "Заказано товаров на сумму, ₽"
  ) {
    return null;
  }

  const rows: YandexAnalyticsRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const vendorArticle = cellStr(row, 3);
    if (!vendorArticle) return;
    rows.push({
      vendorArticle,
      name: cellStr(row, 4),
      qtyOrdered: cellNum(row, 8),
      revenueOrderedRub: cellNum(row, 9),
      qtyDelivered: cellNum(row, 12),
      revenueDeliveredRub: cellNum(row, 13),
    });
  });

  return rows;
}
