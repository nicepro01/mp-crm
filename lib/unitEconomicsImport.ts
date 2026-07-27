import ExcelJS from "exceljs";

function cellStr(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in (v as any)) return String((v as any).result ?? "").trim();
  return String(v).trim();
}

function cellNum(row: ExcelJS.Row, col: number): number | null {
  const v = row.getCell(col).value;
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "object" && v && "result" in (v as any) ? Number((v as any).result) : Number(v);
  return Number.isFinite(n) ? n : null;
}

export type OzonUnitEconomicsRow = {
  vendorCode: string;

  purchasePriceRub: number | null; // "Цена закупки"
  batchQty: number | null; // "Количество шт. в партии"
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;

  cogsPerUnitRub: number | null; // "Себестоимость единицы"

  sellPriceRub: number | null; // "Цена поставщика до скидок OZON"
  mpCommissionPct: number | null; // "Комиссия OZON %" (доля 0..1)
  mpCommissionRub: number | null; // "Комиссия OZON"
  acquiringRub: number | null; // "Эквайринг"
  volumeL: number | null;
  schemeType: string | null; // "Схема работы" FBO/FBS

  supplyCluster: string | null;
  deliveryCluster: string | null;
  baseTariffRub: number | null;
  markupRub: number | null;
  fbsHandlingRub: number | null;
  deliveryHandoutRub: number | null;
  totalDeliveryLogisticsRub: number | null;
  returnLogisticsRub: number | null;
  buybackPct: number | null; // "% выкупа" (доля 0..1)
  totalLogisticsRub: number | null; // "Итого логистика"
  logisticsPctOfRevenue: number | null;

  otherFeesPct: number | null;
  otherFeesRub: number | null;

  totalOzonDeductionsRub: number | null;
  totalOzonDeductionsPct: number | null;
  payoutRub: number | null; // "К оплате поставщику"
  coInvestPct: number | null; // "% соинвеста"

  taxSystem: string | null;
  taxRate: number | null;
  revenueRub: number | null; // "Сумма реализации"
  vatPct: number | null;
  vatRub: number | null;
  taxBaseRub: number | null;
  taxAmountRub: number | null; // "Налог (А)УСН"
  totalTaxRub: number | null;
  taxPctOfRevenue: number | null;

  profitPerUnitRub: number | null;
  profitPerBatchRub: number | null;
  netMarginPct: number | null; // "Маржинальность по чистой прибыли" (доля 0..1)
  roiPct: number | null;
};

/**
 * Разбор листа калькулятора юнит-экономики Ozon (шаблон из телеграм-канала
 * "FinancialReports_MP_Malitskaya") — листы "ЮЭ RS" и "ЮЭ Gral" имеют
 * одинаковую структуру: составной заголовок в строках 6-9, данные с 10-й.
 * Колонка A — короткий артикул продавца (vendorCode), совпадает с тем, что
 * используется в остальных выгрузках площадок.
 */
export async function parseOzonUnitEconomicsSheet(
  buffer: Buffer,
  sheetName: string
): Promise<OzonUnitEconomicsRow[] | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const sheet = workbook.worksheets.find((ws) => ws.name === sheetName);
  if (!sheet) return null;

  const header = sheet.getRow(9);
  if (cellStr(header, 1) !== "Название товара" || cellStr(header, 14).indexOf("Цена поставщика") !== 0) {
    return null;
  }

  const rows: OzonUnitEconomicsRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 9) return;
    const vendorCode = cellStr(row, 1);
    if (!vendorCode) return;

    rows.push({
      vendorCode,
      purchasePriceRub: cellNum(row, 2),
      batchQty: cellNum(row, 3),
      lengthCm: cellNum(row, 4),
      widthCm: cellNum(row, 5),
      heightCm: cellNum(row, 6),
      cogsPerUnitRub: cellNum(row, 13),
      sellPriceRub: cellNum(row, 14),
      mpCommissionPct: cellNum(row, 15),
      mpCommissionRub: cellNum(row, 16),
      acquiringRub: cellNum(row, 17),
      volumeL: cellNum(row, 18),
      schemeType: cellStr(row, 19) || null,
      supplyCluster: cellStr(row, 20) || null,
      deliveryCluster: cellStr(row, 21) || null,
      baseTariffRub: cellNum(row, 22),
      markupRub: cellNum(row, 23),
      fbsHandlingRub: cellNum(row, 24),
      deliveryHandoutRub: cellNum(row, 25),
      totalDeliveryLogisticsRub: cellNum(row, 26),
      returnLogisticsRub: cellNum(row, 27),
      buybackPct: cellNum(row, 28),
      totalLogisticsRub: cellNum(row, 29),
      logisticsPctOfRevenue: cellNum(row, 30),
      otherFeesPct: cellNum(row, 31),
      otherFeesRub: cellNum(row, 32),
      totalOzonDeductionsRub: cellNum(row, 33),
      totalOzonDeductionsPct: cellNum(row, 34),
      payoutRub: cellNum(row, 35),
      coInvestPct: cellNum(row, 36),
      taxSystem: cellStr(row, 37) || null,
      taxRate: cellNum(row, 38),
      revenueRub: cellNum(row, 39),
      vatPct: cellNum(row, 40),
      vatRub: cellNum(row, 41),
      taxBaseRub: cellNum(row, 42),
      taxAmountRub: cellNum(row, 43),
      totalTaxRub: cellNum(row, 44),
      taxPctOfRevenue: cellNum(row, 45),
      profitPerUnitRub: cellNum(row, 46),
      profitPerBatchRub: cellNum(row, 47),
      netMarginPct: cellNum(row, 48),
      roiPct: cellNum(row, 49),
    });
  });

  return rows;
}

/** Разбирает оба листа калькулятора ("ЮЭ RS" и "ЮЭ Gral") сразу. */
export async function parseOzonUnitEconomicsFile(buffer: Buffer): Promise<OzonUnitEconomicsRow[]> {
  const sheets = ["ЮЭ RS", "ЮЭ Gral"];
  const all: OzonUnitEconomicsRow[] = [];
  for (const name of sheets) {
    const rows = await parseOzonUnitEconomicsSheet(buffer, name);
    if (rows) all.push(...rows);
  }
  return all;
}
