import type { SupplierCountry } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeSeasonalIndex, seasonalWeightForWindow } from "@/lib/seasonality";
import { allocateProportionally } from "@/lib/allocateProportionally";
import { PlannerRow, MarketplaceStat } from "./plannerShared";

// Извлечено из page.tsx, чтобы тот же расчёт можно было переиспользовать для
// /batches/plan-ru (российские поставщики) без дублирования ~300 строк —
// единственное отличие между двумя планировщиками это фильтр по
// Supplier.country, вся остальная логика (сезонность, MOQ, распределение "в
// пути" по площадкам/складам) общая. См. комментарий у SupplierCountry в
// schema.prisma: у Китая и России принципиально разные горизонты лид-тайма,
// смешивать их в одном списке неудобно — но способ заказа (поставка с
// логистическим статусом) один и тот же для обоих.
const DEFAULT_LEAD_TIME_DAYS = 120;

export type WarehouseStat = {
  warehouseName: string;
  qtyAvailable: number;
  avgDailySalesQty: number;
  recommendedOrderQty: number;
};

export type PlannerData = {
  rows: PlannerRow[];
  marketplaceStats: Record<string, Record<string, MarketplaceStat>>;
  warehouseStatsByProduct: Record<string, Record<string, WarehouseStat[]>>;
  marketplaceNames: Record<string, string>;
} | null; // null — вообще нет активных листингов под этот фильтр

export async function buildPlannerData(supplierCountry: SupplierCountry): Promise<PlannerData> {
  const [activeListingsRaw, allStockRowsRaw, monthlySales, buybackRows, allWarehouseRowsRaw] = await Promise.all([
    prisma.mpListing.findMany({
      where: { isActive: true, product: { isActive: true } },
      include: { product: { include: { supplier: true } }, marketplace: { select: { name: true } } },
    }),
    prisma.productStockAnalytics.findMany({
      where: { product: { isActive: true } },
      include: { product: { select: { supplierId: true } }, marketplace: { select: { name: true } } },
    }),
    prisma.productMonthlySales.findMany({
      where: { product: { isActive: true } },
      select: { productId: true, month: true, qtySold: true, daysInPeriod: true },
    }),
    prisma.unitEconomics.findMany({
      where: { marketplace: "WB", buybackPct: { not: null } },
      orderBy: { calculatedAt: "desc" },
      select: { productId: true, buybackPct: true },
    }),
    prisma.productWarehouseAnalytics.findMany({
      where: { product: { isActive: true } },
      include: { product: { select: { supplierId: true } }, marketplace: { select: { name: true } } },
    }),
  ]);

  // Фильтр по стране поставщика — товары без поставщика вообще не попадают
  // ни в один из двух планировщиков (у них некому задать лид-тайм/MOQ,
  // остаются видны только в общем списке "Товары").
  const activeListings = activeListingsRaw.filter((l) => l.product.supplier?.country === supplierCountry);
  const supplierCountryByProductId = new Map(
    activeListingsRaw.map((l) => [l.productId, l.product.supplier?.country ?? null])
  );
  const allStockRows = allStockRowsRaw.filter((r) => supplierCountryByProductId.get(r.productId) === supplierCountry);
  const allWarehouseRows = allWarehouseRowsRaw.filter(
    (r) => supplierCountryByProductId.get(r.productId) === supplierCountry
  );

  const buybackByProduct = new Map<string, number>();
  for (const r of buybackRows) {
    if (!buybackByProduct.has(r.productId)) buybackByProduct.set(r.productId, Number(r.buybackPct));
  }

  const monthlySalesByProduct = new Map<string, typeof monthlySales>();
  for (const m of monthlySales) {
    const list = monthlySalesByProduct.get(m.productId) ?? [];
    list.push(m);
    monthlySalesByProduct.set(m.productId, list);
  }
  const seasonalIndexByProduct = new Map(
    [...monthlySalesByProduct.entries()].map(([productId, rows]) => [productId, computeSeasonalIndex(rows)])
  );
  const today = new Date();
  function effectiveSeasonalMultiplier(productId: string, manualMultiplier: number, horizonDays: number) {
    const index = seasonalIndexByProduct.get(productId);
    if (!index || index.size === 0) return { value: manualMultiplier, fromHistory: false };
    return { value: seasonalWeightForWindow(index, today, horizonDays), fromHistory: true };
  }

  if (activeListings.length === 0) return null;

  const activeListingKeys = new Set(activeListings.map((l) => `${l.productId}|${l.marketplaceId}`));
  const stockRows = allStockRows.filter((r) => activeListingKeys.has(`${r.productId}|${r.marketplaceId}`));
  const warehouseRows = allWarehouseRows.filter((r) => activeListingKeys.has(`${r.productId}|${r.marketplaceId}`));
  const marketplaceNameById = new Map<string, string>();
  for (const l of activeListings) marketplaceNameById.set(l.marketplaceId, l.marketplace.name);
  for (const r of allStockRows) marketplaceNameById.set(r.marketplaceId, r.marketplace.name);
  for (const r of allWarehouseRows) marketplaceNameById.set(r.marketplaceId, r.marketplace.name);

  const inTransitByProductAll = await prisma.batchItem.groupBy({
    by: ["productId"],
    where: { batch: { logisticsStatus: { not: "RECEIVED" } } },
    _sum: { qty: true },
  });
  const inTransitMap = new Map(
    inTransitByProductAll
      .filter((b) => supplierCountryByProductId.get(b.productId) === supplierCountry)
      .map((b) => [b.productId, b._sum.qty ?? 0])
  );

  type Agg = {
    productId: string;
    sku: string;
    name: string;
    photoUrl: string | null;
    purchasePriceRub: number | null;
    supplierName: string | null;
    moq: number | null;
    leadTimeDays: number;
    buybackPct: number | null;
    qtyAvailable: number;
    avgDailySalesQty: number;
    avgDailySalesQty7d: number;
    seasonalDemandMultiplier: number;
    unitsPerBox: number;
    boxWeightKg: number;
    boxVolumeM3: number;
    marketplaceIds: Set<string>;
  };
  const byProduct = new Map<string, Agg>();
  function ensureAgg(productId: string, product: (typeof activeListings)[number]["product"]) {
    let acc = byProduct.get(productId);
    if (!acc) {
      acc = {
        productId,
        sku: product.sku,
        name: product.name,
        photoUrl: product.photoUrl,
        purchasePriceRub: product.purchasePriceRub ? Number(product.purchasePriceRub) : null,
        supplierName: product.supplier?.name ?? null,
        moq: product.supplier?.moq ?? null,
        leadTimeDays: product.supplier?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS,
        buybackPct: buybackByProduct.get(productId) ?? null,
        qtyAvailable: 0,
        avgDailySalesQty: 0,
        avgDailySalesQty7d: 0,
        seasonalDemandMultiplier: Number(product.seasonalDemandMultiplier),
        unitsPerBox: product.unitsPerBox,
        boxWeightKg: Number(product.boxWeightKg),
        boxVolumeM3: (product.boxLengthMm * product.boxWidthMm * product.boxHeightMm) / 1_000_000_000,
        marketplaceIds: new Set(),
      };
      byProduct.set(productId, acc);
    }
    return acc;
  }

  for (const l of activeListings) {
    const acc = ensureAgg(l.productId, l.product);
    acc.marketplaceIds.add(l.marketplaceId);
  }
  for (const r of stockRows) {
    const acc = byProduct.get(r.productId);
    if (!acc) continue;
    acc.qtyAvailable += r.qtyAvailable;
    acc.avgDailySalesQty += Number(r.avgDailySalesQty);
    acc.avgDailySalesQty7d += Number(r.avgDailySalesQty7d);
  }

  const rows: PlannerRow[] = [...byProduct.values()]
    .map((acc) => {
      const qtyInTransit = inTransitMap.get(acc.productId) ?? 0;
      const daysOfStockLeft = acc.avgDailySalesQty > 0 ? Math.round(acc.qtyAvailable / acc.avgDailySalesQty) : null;
      const daysOfStockLeftAfterArrival =
        acc.avgDailySalesQty > 0 ? Math.round((acc.qtyAvailable + qtyInTransit) / acc.avgDailySalesQty) : null;
      const seasonal = effectiveSeasonalMultiplier(acc.productId, acc.seasonalDemandMultiplier, acc.leadTimeDays);
      const neededForCoverage = acc.avgDailySalesQty * acc.leadTimeDays * seasonal.value;
      const rawRecommendedQty = Math.max(0, Math.ceil(neededForCoverage - acc.qtyAvailable - qtyInTransit));
      const moqApplied = rawRecommendedQty > 0 && acc.moq !== null && rawRecommendedQty < acc.moq;
      const recommendedOrderQty = moqApplied ? acc.moq! : rawRecommendedQty;
      const needsReorder = daysOfStockLeft !== null && daysOfStockLeft <= acc.leadTimeDays;

      return {
        productId: acc.productId,
        sku: acc.sku,
        name: acc.name,
        photoUrl: acc.photoUrl,
        purchasePriceRub: acc.purchasePriceRub,
        supplierName: acc.supplierName,
        moq: acc.moq,
        leadTimeDays: acc.leadTimeDays,
        buybackPct: acc.buybackPct,
        qtyAvailable: acc.qtyAvailable,
        qtyInTransit,
        avgDailySalesQty: Math.round(acc.avgDailySalesQty * 100) / 100,
        avgDailySalesQty7d: Math.round(acc.avgDailySalesQty7d * 100) / 100,
        daysOfStockLeft,
        daysOfStockLeftAfterArrival,
        recommendedOrderQty,
        moqApplied,
        needsReorder,
        seasonalDemandMultiplier: Math.round(seasonal.value * 100) / 100,
        seasonalFromHistory: seasonal.fromHistory,
        unitsPerBox: acc.unitsPerBox,
        boxWeightKg: acc.boxWeightKg,
        boxVolumeM3: acc.boxVolumeM3,
        marketplaceIds: [...acc.marketplaceIds],
        marketplaces: [...acc.marketplaceIds]
          .map((id) => marketplaceNameById.get(id) ?? id)
          .sort()
          .join(", "),
      };
    })
    .sort((a, b) => (a.daysOfStockLeft ?? Infinity) - (b.daysOfStockLeft ?? Infinity));

  const manualSeasonalByProduct = new Map([...byProduct.values()].map((acc) => [acc.productId, acc.seasonalDemandMultiplier]));
  const leadTimeByProduct = new Map([...byProduct.values()].map((acc) => [acc.productId, acc.leadTimeDays]));
  const moqByProduct = new Map([...byProduct.values()].map((acc) => [acc.productId, acc.moq]));
  type RawMarketplaceStat = {
    marketplaceId: string;
    qtyAvailable: number;
    avgDaily: number;
    avgDaily7d: number;
    daysOfStockLeft: number | null;
    rawNeed: number;
    recommendedOrderQty: number;
    moqApplied: boolean;
    needsReorder: boolean;
  };
  const rawStatsByProduct = new Map<string, RawMarketplaceStat[]>();
  for (const r of stockRows) {
    const avgDaily = Number(r.avgDailySalesQty);
    const avgDaily7d = Number(r.avgDailySalesQty7d);
    const leadTimeDays = leadTimeByProduct.get(r.productId) ?? DEFAULT_LEAD_TIME_DAYS;
    const moq = moqByProduct.get(r.productId) ?? null;
    const seasonal = effectiveSeasonalMultiplier(r.productId, manualSeasonalByProduct.get(r.productId) ?? 1, leadTimeDays);
    const daysOfStockLeft = avgDaily > 0 ? Math.round(r.qtyAvailable / avgDaily) : null;
    const neededForCoverage = avgDaily * leadTimeDays * seasonal.value;
    const rawNeed = Math.max(0, neededForCoverage - r.qtyAvailable);
    const qtyInTransitTotal = inTransitMap.get(r.productId) ?? 0;
    const rawRecommendedQty = Math.max(0, Math.ceil(neededForCoverage - r.qtyAvailable - qtyInTransitTotal));
    const moqApplied = rawRecommendedQty > 0 && moq !== null && rawRecommendedQty < moq;
    const recommendedOrderQty = moqApplied ? moq! : rawRecommendedQty;
    const needsReorder = daysOfStockLeft !== null && daysOfStockLeft <= leadTimeDays;

    const list = rawStatsByProduct.get(r.productId) ?? [];
    list.push({
      marketplaceId: r.marketplaceId,
      qtyAvailable: r.qtyAvailable,
      avgDaily,
      avgDaily7d,
      daysOfStockLeft,
      rawNeed,
      recommendedOrderQty,
      moqApplied,
      needsReorder,
    });
    rawStatsByProduct.set(r.productId, list);
  }

  const marketplaceStats: Record<string, Record<string, MarketplaceStat>> = {};
  for (const l of activeListings) {
    (marketplaceStats[l.marketplaceId] ??= {})[l.productId] ??= {
      qtyAvailable: 0,
      avgDailySalesQty: 0,
      avgDailySalesQty7d: 0,
      daysOfStockLeft: null,
      daysOfStockLeftAfterArrival: null,
      qtyInTransitAllocated: 0,
      recommendedOrderQty: 0,
      moqApplied: false,
      needsReorder: false,
    };
  }
  for (const [productId, list] of rawStatsByProduct) {
    const qtyInTransitTotal = inTransitMap.get(productId) ?? 0;
    const allocations = allocateProportionally(
      qtyInTransitTotal,
      list.map((s) => s.rawNeed)
    );
    list.forEach((s, i) => {
      const qtyInTransitAllocated = allocations[i];
      const daysOfStockLeftAfterArrival = s.avgDaily > 0 ? Math.round((s.qtyAvailable + qtyInTransitAllocated) / s.avgDaily) : null;

      (marketplaceStats[s.marketplaceId] ??= {})[productId] = {
        qtyAvailable: s.qtyAvailable,
        avgDailySalesQty: Math.round(s.avgDaily * 100) / 100,
        avgDailySalesQty7d: Math.round(s.avgDaily7d * 100) / 100,
        daysOfStockLeft: s.daysOfStockLeft,
        daysOfStockLeftAfterArrival,
        qtyInTransitAllocated,
        recommendedOrderQty: s.recommendedOrderQty,
        moqApplied: s.moqApplied,
        needsReorder: s.needsReorder,
      };
    });
  }

  const warehouseStatsByProduct: Record<string, Record<string, WarehouseStat[]>> = {};
  const warehouseRowsByKey = new Map<string, typeof warehouseRows>();
  for (const r of warehouseRows) {
    const key = `${r.productId}|${r.marketplaceId}`;
    const list = warehouseRowsByKey.get(key) ?? [];
    list.push(r);
    warehouseRowsByKey.set(key, list);
  }

  for (const [key, list] of warehouseRowsByKey) {
    const sep = key.indexOf("|");
    const productId = key.slice(0, sep);
    const marketplaceId = key.slice(sep + 1);
    const stat = marketplaceStats[marketplaceId]?.[productId];
    const recommendedTotal = stat?.recommendedOrderQty ?? 0;

    let allocations: number[];
    if (recommendedTotal > 0) {
      const leadTimeDays = leadTimeByProduct.get(productId) ?? DEFAULT_LEAD_TIME_DAYS;
      const seasonal = effectiveSeasonalMultiplier(productId, manualSeasonalByProduct.get(productId) ?? 1, leadTimeDays);
      const totalQtyAvailable = list.reduce((sum, r) => sum + r.qtyAvailable, 0);
      const weights = list.map((r) => {
        const avgDaily = Number(r.avgDailySalesQty);
        const targetQty = avgDaily > 0 ? avgDaily * leadTimeDays * seasonal.value : totalQtyAvailable / list.length;
        return Math.max(0, targetQty - r.qtyAvailable);
      });
      allocations = allocateProportionally(recommendedTotal, weights);
    } else {
      allocations = list.map(() => 0);
    }

    (warehouseStatsByProduct[marketplaceId] ??= {})[productId] = list.map((r, i) => ({
      warehouseName: r.warehouseName,
      qtyAvailable: r.qtyAvailable,
      avgDailySalesQty: Math.round(Number(r.avgDailySalesQty) * 100) / 100,
      recommendedOrderQty: allocations[i],
    }));
  }

  return {
    rows,
    marketplaceStats,
    warehouseStatsByProduct,
    marketplaceNames: Object.fromEntries(marketplaceNameById),
  };
}
