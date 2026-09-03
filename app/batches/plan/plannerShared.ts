import { compareForSort } from "@/lib/sortCompare";
import { applyMultiSort, PinnedSort } from "@/lib/useMultiSort";

export type PlannerRow = {
  productId: string;
  sku: string;
  // Артикул поставщика (Product.vendorCode) — код, под которым товар
  // числится у самого поставщика (Грал/Маяк/Сонатекс), не наш внутренний
  // sku. Нужен отдельно: staff ссылается на него при оформлении реального
  // заказа поставщику, а не на внутренний sku, который поставщику ничего
  // не говорит.
  vendorCode: string | null;
  name: string;
  photoUrl: string | null;
  purchasePriceRub: number | null;
  supplierName: string | null;
  // MOQ (минимальный объём заказа) поставщика — если задан и расчётное
  // количество меньше него, recommendedOrderQty подтягивается до MOQ (см.
  // moqApplied). leadTimeDays — свой у поставщика, иначе запасное значение
  // (см. page.tsx, DEFAULT_LEAD_TIME_DAYS).
  moq: number | null;
  leadTimeDays: number;
  qtyAvailable: number;
  // Тот же остаток, но по схеме продажи — реально лежит на FBO-складе
  // площадки (Ozon/Яндекс.Маркет её собственные региональные склады) или на
  // FBS-складе (площадка забирает со своего/арендованного склада продавца).
  // У WB отдельного FBS-отслеживания пока нет, там всегда 0. Сумма по всем
  // площадкам сразу — если товар продаётся по обеим схемам на нескольких
  // площадках, это уже общий итог, не в разрезе конкретной площадки.
  qtyAvailableFbo: number;
  qtyAvailableFbs: number;
  qtyInTransit: number;
  avgDailySalesQty: number;
  // То же самое, но за последние 7 дней — для сравнения с 28-дневным
  // средним (недавний всплеск/просадка спроса виден раньше).
  avgDailySalesQty7d: number;
  daysOfStockLeft: number | null;
  // Сколько дней хватит остатка, если прямо сейчас придёт то, что уже "в
  // пути" (остаток + вся партия в пути, делить на продажи/день). На
  // вкладках площадок партия распределяется пропорционально нехватке
  // каждой площадки (см. lib/allocateProportionally.ts) — не поровну.
  daysOfStockLeftAfterArrival: number | null;
  recommendedOrderQty: number;
  // true, если recommendedOrderQty подняли до MOQ поставщика (реальная
  // потребность была меньше минимальной партии).
  moqApplied: boolean;
  needsReorder: boolean;
  seasonalDemandMultiplier: number;
  // Коэффициент посчитан по истории продаж (см. lib/seasonality.ts) или это
  // ручное значение из карточки товара (нет данных за нужный период).
  seasonalFromHistory: boolean;
  unitsPerBox: number;
  boxWeightKg: number;
  boxVolumeM3: number;
  // marketplaceId, а не code — два магазина одной площадки (Ozon/Ozon 2)
  // делят один code, группировка по нему схлопывала их в одну вкладку.
  marketplaceIds: string[];
  marketplaces: string;
  // % выкупа на WB (из последнего расчёта юнит-экономики) — единственная
  // площадка, где он сейчас считается по реальным заказам. null, если
  // расчёта ещё не было.
  buybackPct: number | null;
};

// Ниже этого % выкупа на WB считаем товар проблемным — стоит перепроверить
// фото/описание/размеры перед тем как заказывать ещё, а не просто повторять
// объём прошлой поставки.
export const LOW_BUYBACK_THRESHOLD_PCT = 80;

export type MarketplaceStat = {
  qtyAvailable: number;
  avgDailySalesQty: number;
  avgDailySalesQty7d: number;
  daysOfStockLeft: number | null;
  daysOfStockLeftAfterArrival: number | null;
  qtyInTransitAllocated: number;
  recommendedOrderQty: number;
  moqApplied: boolean;
  needsReorder: boolean;
};

export type SortKey =
  | "sku"
  | "vendorCode"
  | "supplierName"
  | "qtyAvailable"
  | "qtyAvailableFbo"
  | "qtyAvailableFbs"
  | "qtyInTransit"
  | "avgDailySalesQty"
  | "avgDailySalesQty7d"
  | "daysOfStockLeft"
  | "daysOfStockLeftAfterArrival"
  | "recommendedOrderQty";

export const columns: { key: SortKey; label: string; type: "string" | "number" }[] = [
  { key: "sku", label: "Товар", type: "string" },
  { key: "vendorCode", label: "Артикул поставщика", type: "string" },
  { key: "supplierName", label: "Поставщик", type: "string" },
  { key: "qtyAvailable", label: "Остаток", type: "number" },
  { key: "qtyAvailableFbo", label: "Остаток FBO", type: "number" },
  { key: "qtyAvailableFbs", label: "Остаток FBS", type: "number" },
  { key: "qtyInTransit", label: "В пути", type: "number" },
  { key: "avgDailySalesQty", label: "Продаж/день (28д)", type: "number" },
  { key: "avgDailySalesQty7d", label: "Продаж/день (7д)", type: "number" },
  { key: "daysOfStockLeft", label: "Дней до конца", type: "number" },
  { key: "daysOfStockLeftAfterArrival", label: "Дней хватит после прихода", type: "number" },
  { key: "recommendedOrderQty", label: "Рекомендовано, шт", type: "number" },
];

export function fmt(n: number) {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

// Общий (statsOverride отсутствует) или по конкретной площадке — всегда
// даёт единый набор полей для отображения/сортировки/подсветки.
export function displayStats(r: PlannerRow, statsOverride?: Record<string, MarketplaceStat>): MarketplaceStat {
  const override = statsOverride?.[r.productId];
  if (override) return override;
  return {
    qtyAvailable: r.qtyAvailable,
    avgDailySalesQty: r.avgDailySalesQty,
    avgDailySalesQty7d: r.avgDailySalesQty7d,
    daysOfStockLeft: r.daysOfStockLeft,
    daysOfStockLeftAfterArrival: r.daysOfStockLeftAfterArrival,
    qtyInTransitAllocated: r.qtyInTransit,
    recommendedOrderQty: r.recommendedOrderQty,
    moqApplied: r.moqApplied,
    needsReorder: r.needsReorder,
  };
}

function compareByKey(
  a: PlannerRow,
  b: PlannerRow,
  key: SortKey,
  dir: "asc" | "desc",
  statsOverride?: Record<string, MarketplaceStat>
): number {
  if (key === "sku") return compareForSort(a.sku, b.sku, "string", dir);
  if (key === "vendorCode") return compareForSort(a.vendorCode, b.vendorCode, "string", dir);
  if (key === "supplierName") return compareForSort(a.supplierName, b.supplierName, "string", dir);
  if (key === "qtyInTransit") return compareForSort(a.qtyInTransit, b.qtyInTransit, "number", dir);
  if (key === "qtyAvailableFbo") return compareForSort(a.qtyAvailableFbo, b.qtyAvailableFbo, "number", dir);
  if (key === "qtyAvailableFbs") return compareForSort(a.qtyAvailableFbs, b.qtyAvailableFbs, "number", dir);
  const col = columns.find((c) => c.key === key);
  const statsA = displayStats(a, statsOverride);
  const statsB = displayStats(b, statsOverride);
  return compareForSort(statsA[key], statsB[key], col?.type, dir);
}

// Плоский список без группировки по поставщику — так сортировка по любой
// колонке (в т.ч. по количеству) работает по всей таблице сразу, а не
// внутри каждой группы отдельно. Поддерживает закреплённый первый уровень
// сортировки (см. lib/useMultiSort.ts) — обычный клик по другой колонке
// становится вторым уровнем, а не заменяет закреплённую.
export function sortRows(
  tabRows: PlannerRow[],
  sortKey: SortKey,
  sortDir: "asc" | "desc",
  statsOverride?: Record<string, MarketplaceStat>,
  pinned?: PinnedSort<SortKey> | null
): PlannerRow[] {
  return applyMultiSort(
    tabRows,
    (a, b, key, dir) => compareByKey(a, b, key, dir, statsOverride),
    pinned ?? null,
    sortKey,
    sortDir
  );
}
