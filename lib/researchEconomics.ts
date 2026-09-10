// Порт косто-модели Ozon FBS из mp-research (src/economics/*). Чистая
// математика без зависимостей — используется и на сервере, и в браузере
// (пересчёт «что если» на экране /research).
//
// Держать в синхроне с mp-research/src/economics/costModel.ts + unitEconomics.ts.
// ⚠️ Тарифы Ozon — ориентир на 2026-09, проверять в ЛК Ozon.

export type CostSource = "тариф" | "оценка" | "ввод";

export interface CostModel {
  commissionPct: number;
  commissionLowThreshold1: number;
  commissionLowPct1: number;
  commissionLowThreshold2: number;
  commissionLowPct2: number;

  logisticsFirstLiter: number;
  logisticsLiter2to3: number;
  logisticsLiter3plus: number;
  volumeLiters: number;

  processingPct: number;
  processingMin: number;
  processingMax: number;

  lastMilePct: number;
  lastMileMin: number;
  lastMileMax: number;

  returnRate: number;
  returnLogisticsCost: number;

  acquiringPct: number;
  adsPct: number;
  rkoPct: number;

  inbound: number;
  packaging: number;
  storagePerUnit: number;

  taxScheme: "usn6" | "usn15";
}

export const DEFAULT_COST_MODEL: CostModel = {
  commissionPct: 0.15,
  commissionLowThreshold1: 100,
  commissionLowPct1: 0.17,
  commissionLowThreshold2: 300,
  commissionLowPct2: 0.23,
  logisticsFirstLiter: 80,
  logisticsLiter2to3: 18,
  logisticsLiter3plus: 23,
  volumeLiters: 1,
  processingPct: 0.02,
  processingMin: 15,
  processingMax: 200,
  lastMilePct: 0.055,
  lastMileMin: 0,
  lastMileMax: 999999,
  returnRate: 0.1,
  returnLogisticsCost: 55,
  acquiringPct: 0,
  adsPct: 0.12,
  rkoPct: 0.007,
  inbound: 40,
  packaging: 15,
  storagePerUnit: 0,
  taxScheme: "usn6",
};

export const LINE_SOURCE: Record<string, CostSource> = {
  commission: "тариф",
  logisticsFbs: "тариф",
  processing: "тариф",
  lastMile: "тариф",
  acquiring: "тариф",
  tax: "тариф",
  returnsCost: "оценка",
  ads: "оценка",
  rko: "ввод",
  cogs: "ввод",
  inbound: "ввод",
  packaging: "ввод",
  storage: "ввод",
};

export const LINE_LABEL: Record<string, string> = {
  commission: "Комиссия Ozon",
  logisticsFbs: "Логистика FBS (объём)",
  processing: "Обработка отправления",
  lastMile: "Последняя миля",
  acquiring: "Эквайринг",
  returnsCost: "Возвраты (обр. логистика × %)",
  ads: "Продвижение",
  rko: "РКО банка",
  cogs: "Закупка (COGS)",
  inbound: "Логистика от поставщика",
  packaging: "Упаковка / маркировка",
  storage: "Хранение FBS",
  tax: "Налог УСН 6%",
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function commissionRub(price: number, m: CostModel): number {
  if (price <= m.commissionLowThreshold1) return price * m.commissionLowPct1;
  if (price <= m.commissionLowThreshold2) return price * m.commissionLowPct2;
  return price * m.commissionPct;
}

export function logisticsFbsRub(m: CostModel): number {
  const L = Math.max(1, Math.ceil(m.volumeLiters));
  let c = m.logisticsFirstLiter;
  if (L >= 2) c += Math.min(L - 1, 2) * m.logisticsLiter2to3;
  if (L > 3) c += (L - 3) * m.logisticsLiter3plus;
  return c;
}

export interface LineItem {
  amount: number;
  source: CostSource;
}
export type LineItems = Record<string, LineItem>;

export interface UnitEconomicsResult {
  sellPrice: number;
  lineItems: LineItems;
  totalCosts: number;
  profitPerUnit: number;
  marginPct: number;
  roiPct: number;
  profitPerMonth: number;
}

const li = (amount: number, key: string): LineItem => ({
  amount: round2(amount),
  source: LINE_SOURCE[key] ?? "оценка",
});
const sum = (items: LineItems) => Object.values(items).reduce((s, x) => s + x.amount, 0);

export function computeUnitEconomics(args: {
  sellPrice: number;
  cogs: number;
  monthlyUnits: number;
  model: CostModel;
}): UnitEconomicsResult {
  const { sellPrice: P, cogs, monthlyUnits, model: m } = args;

  const lastMile = clamp(P * m.lastMilePct, m.lastMileMin, m.lastMileMax);
  const processing = clamp(P * m.processingPct, m.processingMin, m.processingMax);
  const returnsCost = m.returnRate * m.returnLogisticsCost;

  const items: LineItems = {
    commission: li(commissionRub(P, m), "commission"),
    logisticsFbs: li(logisticsFbsRub(m), "logisticsFbs"),
    processing: li(processing, "processing"),
    lastMile: li(lastMile, "lastMile"),
    acquiring: li(P * m.acquiringPct, "acquiring"),
    returnsCost: li(returnsCost, "returnsCost"),
    ads: li(P * m.adsPct, "ads"),
    rko: li(P * m.rkoPct, "rko"),
    cogs: li(cogs, "cogs"),
    inbound: li(m.inbound, "inbound"),
    packaging: li(m.packaging, "packaging"),
    storage: li(m.storagePerUnit, "storage"),
    tax: li(0, "tax"),
  };
  const beforeTax = P - sum(items);
  items.tax = li(m.taxScheme === "usn6" ? P * 0.06 : Math.max(0, beforeTax) * 0.15, "tax");

  const totalCosts = sum(items);
  const profitPerUnit = P - totalCosts;
  const investment = cogs + m.inbound + m.packaging;

  return {
    sellPrice: round2(P),
    lineItems: items,
    totalCosts: round2(totalCosts),
    profitPerUnit: round2(profitPerUnit),
    marginPct: P > 0 ? round2((profitPerUnit / P) * 100) : 0,
    roiPct: investment > 0 ? round2((profitPerUnit / investment) * 100) : 0,
    profitPerMonth: round2(profitPerUnit * monthlyUnits),
  };
}

export function maxCogsForTargetMargin(args: {
  sellPrice: number;
  targetMarginPct: number;
  model: CostModel;
}): number {
  const { sellPrice: P, targetMarginPct, model: m } = args;
  const lastMile = clamp(P * m.lastMilePct, m.lastMileMin, m.lastMileMax);
  const processing = clamp(P * m.processingPct, m.processingMin, m.processingMax);
  const returnsCost = m.returnRate * m.returnLogisticsCost;
  const taxPct = m.taxScheme === "usn6" ? 0.06 : 0;
  const pctCosts = commissionRub(P, m) + P * (m.acquiringPct + m.adsPct + m.rkoPct + taxPct);
  const fixedCosts =
    logisticsFbsRub(m) + processing + lastMile + returnsCost + m.inbound + m.packaging + m.storagePerUnit;
  return round2(P - pctCosts - fixedCosts - (targetMarginPct / 100) * P);
}
