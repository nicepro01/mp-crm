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

export type WbStockRow = {
  vendorArticle: string; // "Артикул продавца" — единственный общий ключ между отчётами WB, числового ID тут нет
  category: string; // "Предмет"
  qty: number; // "Всего находится на складах" (сумма по всем складам WB)
};

/**
 * Разбор родного отчёта WB "Остатки" (лист "Sheet1" — экспорт из
 * личного кабинета). В отличие от Ozon, тут уже одна строка на SKU
 * (агрегат по всем складам WB готов), суммировать вручную не нужно.
 * Числового ID товара на стороне WB в этом отчёте нет — только
 * "Артикул продавца", его и используем как mpSku.
 */
export async function parseWbStockFile(buffer: Buffer): Promise<WbStockRow[] | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const sheet = workbook.worksheets[0];
  if (!sheet) return null;

  const header = sheet.getRow(1);
  if (
    cellStr(header, 1) !== "Бренд" ||
    cellStr(header, 3) !== "Артикул продавца" ||
    cellStr(header, 6) !== "Всего находится на складах"
  ) {
    return null;
  }

  const rows: WbStockRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const vendorArticle = cellStr(row, 3);
    if (!vendorArticle) return;
    rows.push({
      vendorArticle,
      category: cellStr(row, 2),
      qty: cellNum(row, 6),
    });
  });

  return rows;
}

export type WbAnalyticsRow = {
  vendorArticle: string;
  wbArticleId: string; // "Артикул WB" — числовой ID, есть только в этом отчёте
  name: string;
  qtyOrdered: number; // "Заказали товаров, шт"
  qtyBought: number; // "Выкупили, шт" — может быть 0 на коротких периодах из-за задержки доставки
  revenueOrderedRub: number; // "Заказали на сумму, ₽"
  revenueBoughtRub: number; // "Выкупили на сумму, ₽"
  avgPriceRub: number; // "Средняя цена, ₽"
  avgDailyOrders: number; // "Среднее количество заказов в день, шт"
  stockWbQty: number; // "Остатки «Склад WB», шт"
  stockOwnQty: number; // "Остатки «Свой склад», шт"
};

/**
 * Разбор отчёта WB "Оборачиваемость" (лист "Товары" — воронка продаж по
 * карточкам). Заголовок на 2-й строке (1-я — общий заголовок листа),
 * данные с 3-й. В отличие от Ozon, здесь есть реальная цена и выручка —
 * можно использовать для юнит-экономики, а не только скорость продаж.
 */
export async function parseWbAnalyticsFile(buffer: Buffer): Promise<WbAnalyticsRow[] | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const sheet = workbook.worksheets.find((ws) => ws.name === "Товары");
  if (!sheet) return null;

  const header = sheet.getRow(2);
  if (cellStr(header, 1) !== "Артикул продавца" || cellStr(header, 2) !== "Артикул WB") {
    return null;
  }

  const rows: WbAnalyticsRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 2) return;
    const vendorArticle = cellStr(row, 1);
    if (!vendorArticle) return;
    rows.push({
      vendorArticle,
      wbArticleId: cellStr(row, 2),
      name: cellStr(row, 3),
      qtyOrdered: cellNum(row, 21),
      qtyBought: cellNum(row, 23),
      revenueOrderedRub: cellNum(row, 33),
      revenueBoughtRub: cellNum(row, 36),
      avgPriceRub: cellNum(row, 40),
      avgDailyOrders: cellNum(row, 42),
      stockWbQty: cellNum(row, 44),
      stockOwnQty: cellNum(row, 45),
    });
  });

  return rows;
}
