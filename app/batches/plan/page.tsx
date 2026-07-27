import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import PlannerForm from "./PlannerForm";
import { PlannerRow } from "./plannerShared";
import { computeSeasonalIndex, seasonalWeightForWindow } from "@/lib/seasonality";
import { allocateProportionally } from "@/lib/allocateProportionally";

export const dynamic = "force-dynamic";

// Те же пороги, что и на вкладке "Пора заказывать" в Аналитике — план
// закупки должен показывать ровно то же самое, что там уже считается
// "пора заказывать", просто с возможностью сразу оформить поставку.
// 120 дней — и порог срочности ("критично"/нужно заказывать), и целевое
// покрытие для расчёта количества — используется как запасное значение,
// если у поставщика товара не указан свой leadTimeDays (см. ниже).
const DEFAULT_LEAD_TIME_DAYS = 120;

const marketplaceLabels: Record<string, string> = {
  WB: "Wildberries",
  OZON: "Ozon",
  YANDEX_MARKET: "Яндекс.Маркет",
};

export default async function BatchPlannerPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => BatchPlannerPageContent());
}

async function BatchPlannerPageContent() {
  // Активные листинги — это полный список товаров, которые должны попасть
  // в свою вкладку площадки, даже если по ним ещё нет синхронизированной
  // аналитики (новый товар, ждём первую поставку и т.п.). Раньше вкладки
  // строились только из product_stock_analytics, и такие товары просто
  // пропадали из планировщика целиком.
  const [activeListings, allStockRows, monthlySales, buybackRows, allWarehouseRows] = await Promise.all([
    prisma.mpListing.findMany({
      where: { isActive: true, product: { isActive: true } },
      include: { product: { include: { supplier: true } }, marketplace: { select: { code: true } } },
    }),
    prisma.productStockAnalytics.findMany({
      where: { product: { isActive: true } },
      include: { marketplace: { select: { code: true } } },
    }),
    prisma.productMonthlySales.findMany({
      where: { product: { isActive: true } },
      select: { productId: true, month: true, qtySold: true, daysInPeriod: true },
    }),
    // % выкупа сейчас считается только для WB (реальные заказы, не просто
    // продажи/возвраты) — берём последний расчёт на товар, чтобы показать
    // предупреждение в планировщике для проблемных SKU.
    prisma.unitEconomics.findMany({
      where: { marketplace: "WB", buybackPct: { not: null } },
      orderBy: { calculatedAt: "desc" },
      select: { productId: true, buybackPct: true },
    }),
    // Остаток/продажи по конкретному складу (городу) — для распределения
    // поставки внутри площадки, см. lib/allocateProportionally.ts ниже.
    prisma.productWarehouseAnalytics.findMany({
      where: { product: { isActive: true } },
      include: { marketplace: { select: { code: true } } },
    }),
  ]);
  const buybackByProduct = new Map<string, number>();
  for (const r of buybackRows) {
    if (!buybackByProduct.has(r.productId)) buybackByProduct.set(r.productId, Number(r.buybackPct));
  }

  // Индекс сезонности по товару, посчитанный из накопленной истории продаж
  // (см. lib/seasonality.ts) — там, где данных достаточно, используется
  // вместо ручного seasonalDemandMultiplier с карточки товара.
  const monthlySalesByProduct = new Map<string, typeof monthlySales>();
  for (const m of monthlySales) {
    const list = monthlySalesByProduct.get(m.productId) ?? [];
    list.push(m);
    monthlySalesByProduct.set(m.productId, list);
  }
  const seasonalIndexByProduct = new Map(
    [...monthlySalesByProduct.entries()].map(([productId, rows]) => [
      productId,
      computeSeasonalIndex(rows),
    ])
  );
  const today = new Date();
  function effectiveSeasonalMultiplier(productId: string, manualMultiplier: number, horizonDays: number) {
    const index = seasonalIndexByProduct.get(productId);
    if (!index || index.size === 0) return { value: manualMultiplier, fromHistory: false };
    return { value: seasonalWeightForWindow(index, today, horizonDays), fromHistory: true };
  }

  if (activeListings.length === 0) {
    return (
      <div>
        <h1>Планировщик поставок</h1>
        <p className="muted">
          Пока нет ни одного активного листинга — добавьте товары на
          площадках на странице «Площадки», чтобы здесь появился расчёт,
          что и сколько заказывать.
        </p>
      </div>
    );
  }

  // Аналитика должна учитываться только там, где листинг реально активен
  // (товар мог быть снят с продажи именно на этой площадке, но жив на
  // других) — сверяем по тому же набору активных листингов.
  const activeListingKeys = new Set(
    activeListings.map((l) => `${l.productId}|${l.marketplace.code}`)
  );
  const stockRows = allStockRows.filter((r) =>
    activeListingKeys.has(`${r.productId}|${r.marketplace.code}`)
  );
  const warehouseRows = allWarehouseRows.filter((r) =>
    activeListingKeys.has(`${r.productId}|${r.marketplace.code}`)
  );

  const inTransitByProduct = await prisma.batchItem.groupBy({
    by: ["productId"],
    where: { batch: { logisticsStatus: { not: "RECEIVED" } } },
    _sum: { qty: true },
  });
  const inTransitMap = new Map(inTransitByProduct.map((b) => [b.productId, b._sum.qty ?? 0]));

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
    seasonalDemandMultiplier: number;
    unitsPerBox: number;
    boxWeightKg: number;
    boxVolumeM3: number;
    marketplaceCodes: Set<string>;
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
        seasonalDemandMultiplier: Number(product.seasonalDemandMultiplier),
        unitsPerBox: product.unitsPerBox,
        boxWeightKg: Number(product.boxWeightKg),
        boxVolumeM3: (product.boxLengthMm * product.boxWidthMm * product.boxHeightMm) / 1_000_000_000,
        marketplaceCodes: new Set(),
      };
      byProduct.set(productId, acc);
    }
    return acc;
  }

  // Сначала заводим запись на каждый активный листинг — так товар без
  // синхронизированной аналитики всё равно попадёт в свою вкладку площадки
  // (просто с нулевыми остатком/продажами вместо реальных цифр).
  for (const l of activeListings) {
    const acc = ensureAgg(l.productId, l.product);
    acc.marketplaceCodes.add(l.marketplace.code);
  }
  // Затем добавляем реальные цифры там, где аналитика есть.
  for (const r of stockRows) {
    const acc = byProduct.get(r.productId);
    if (!acc) continue;
    acc.qtyAvailable += r.qtyAvailable;
    acc.avgDailySalesQty += Number(r.avgDailySalesQty);
  }

  const rows: PlannerRow[] = [...byProduct.values()]
    .map((acc) => {
      const qtyInTransit = inTransitMap.get(acc.productId) ?? 0;
      const daysOfStockLeft =
        acc.avgDailySalesQty > 0 ? Math.round(acc.qtyAvailable / acc.avgDailySalesQty) : null;
      const daysOfStockLeftAfterArrival =
        acc.avgDailySalesQty > 0
          ? Math.round((acc.qtyAvailable + qtyInTransit) / acc.avgDailySalesQty)
          : null;
      const seasonal = effectiveSeasonalMultiplier(
        acc.productId,
        acc.seasonalDemandMultiplier,
        acc.leadTimeDays
      );
      const neededForCoverage = acc.avgDailySalesQty * acc.leadTimeDays * seasonal.value;
      const rawRecommendedQty = Math.max(
        0,
        Math.ceil(neededForCoverage - acc.qtyAvailable - qtyInTransit)
      );
      // MOQ поставщика — если что-то заказывать всё равно надо, но расчётное
      // количество меньше минимальной партии фабрики, реальный заказ будет
      // не меньше MOQ (заказать меньше физически нельзя).
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
        marketplaceCodes: [...acc.marketplaceCodes],
        marketplaces: [...acc.marketplaceCodes]
          .map((code) => marketplaceLabels[code] ?? code)
          .sort()
          .join(", "),
      };
    })
    .sort((a, b) => (a.daysOfStockLeft ?? Infinity) - (b.daysOfStockLeft ?? Infinity));

  // На вкладке конкретной площадки нужны свои цифры (остаток/продажи/дни/
  // рекомендовано именно там), а не общая сумма по всем каналам — считаем
  // отдельно, на данных одной площадки, тем же лид-таймом поставщика (см.
  // ensureAgg выше), что и на вкладке "Общая". Сезонность (история или
  // ручная) — та же, что и в общем расчёте по товару, площадки отдельно не
  // делятся.
  //
  // "В пути" физически одна партия из Китая на все каналы, но для расчёта
  // "сколько дней хватит после прихода" по каждой площадке её нужно сначала
  // условно поделить между ними — делим пропорционально тому, насколько
  // каждой площадке не хватает до своего целевого покрытия (та же логика,
  // что и в Аналитике при делении рекомендованного заказа, см.
  // lib/allocateProportionally.ts).
  const manualSeasonalByProduct = new Map(
    [...byProduct.values()].map((acc) => [acc.productId, acc.seasonalDemandMultiplier])
  );
  const leadTimeByProduct = new Map([...byProduct.values()].map((acc) => [acc.productId, acc.leadTimeDays]));
  const moqByProduct = new Map([...byProduct.values()].map((acc) => [acc.productId, acc.moq]));
  type RawMarketplaceStat = {
    code: string;
    qtyAvailable: number;
    avgDaily: number;
    daysOfStockLeft: number | null;
    rawNeed: number;
    recommendedOrderQty: number;
    moqApplied: boolean;
    needsReorder: boolean;
  };
  const rawStatsByProduct = new Map<string, RawMarketplaceStat[]>();
  for (const r of stockRows) {
    const avgDaily = Number(r.avgDailySalesQty);
    const leadTimeDays = leadTimeByProduct.get(r.productId) ?? DEFAULT_LEAD_TIME_DAYS;
    const moq = moqByProduct.get(r.productId) ?? null;
    const seasonal = effectiveSeasonalMultiplier(
      r.productId,
      manualSeasonalByProduct.get(r.productId) ?? 1,
      leadTimeDays
    );
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
      code: r.marketplace.code,
      qtyAvailable: r.qtyAvailable,
      avgDaily,
      daysOfStockLeft,
      rawNeed,
      recommendedOrderQty,
      moqApplied,
      needsReorder,
    });
    rawStatsByProduct.set(r.productId, list);
  }

  const marketplaceStats: Record<string, Record<string, {
    qtyAvailable: number;
    avgDailySalesQty: number;
    daysOfStockLeft: number | null;
    daysOfStockLeftAfterArrival: number | null;
    qtyInTransitAllocated: number;
    recommendedOrderQty: number;
    moqApplied: boolean;
    needsReorder: boolean;
  }>> = {};
  // Сначала — нулевые цифры для каждого активного листинга без аналитики,
  // чтобы такие товары не проваливались на честную заглушку, а не на
  // подмешанные данные с других площадок (см. displayStats в plannerShared).
  for (const l of activeListings) {
    (marketplaceStats[l.marketplace.code] ??= {})[l.productId] ??= {
      qtyAvailable: 0,
      avgDailySalesQty: 0,
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
      const daysOfStockLeftAfterArrival =
        s.avgDaily > 0 ? Math.round((s.qtyAvailable + qtyInTransitAllocated) / s.avgDaily) : null;

      (marketplaceStats[s.code] ??= {})[productId] = {
        qtyAvailable: s.qtyAvailable,
        avgDailySalesQty: Math.round(s.avgDaily * 100) / 100,
        daysOfStockLeft: s.daysOfStockLeft,
        daysOfStockLeftAfterArrival,
        qtyInTransitAllocated,
        recommendedOrderQty: s.recommendedOrderQty,
        moqApplied: s.moqApplied,
        needsReorder: s.needsReorder,
      };
    });
  }

  // Разбивка по складам (городам) внутри каждой площадки — recommendedOrderQty
  // площадки (уже посчитан выше, marketplaceStats) делим между её складами
  // пропорционально нехватке каждого, той же allocateProportionally, что и
  // для деления "в пути" между площадками. Нехватка склада — как и в общем
  // расчёте (продажи × лид-тайм × сезонность − остаток), а если по складу
  // ещё нет данных о продажах (Ozon/Яндекс на первом этапе — см. синки),
  // ориентируемся на выравнивание остатка: цель — среднее по всем складам
  // этой площадки, а не даты по несуществующей скорости продаж.
  type WarehouseStat = {
    warehouseName: string;
    qtyAvailable: number;
    avgDailySalesQty: number;
    recommendedOrderQty: number;
  };
  const warehouseStatsByProduct: Record<string, Record<string, WarehouseStat[]>> = {};

  const warehouseRowsByKey = new Map<string, typeof warehouseRows>();
  for (const r of warehouseRows) {
    const key = `${r.productId}|${r.marketplace.code}`;
    const list = warehouseRowsByKey.get(key) ?? [];
    list.push(r);
    warehouseRowsByKey.set(key, list);
  }

  for (const [key, list] of warehouseRowsByKey) {
    const sep = key.indexOf("|");
    const productId = key.slice(0, sep);
    const code = key.slice(sep + 1);
    // Разбивку показываем всегда, когда есть данные по складам — даже если
    // заказывать сейчас нечего (recommendedOrderQty = 0), это просто
    // информация "где физически лежит и продаётся товар", не только
    // инструмент распределения новой поставки.
    const stat = marketplaceStats[code]?.[productId];
    const recommendedTotal = stat?.recommendedOrderQty ?? 0;

    let allocations: number[];
    if (recommendedTotal > 0) {
      const leadTimeDays = leadTimeByProduct.get(productId) ?? DEFAULT_LEAD_TIME_DAYS;
      const seasonal = effectiveSeasonalMultiplier(
        productId,
        manualSeasonalByProduct.get(productId) ?? 1,
        leadTimeDays
      );
      const totalQtyAvailable = list.reduce((sum, r) => sum + r.qtyAvailable, 0);
      const weights = list.map((r) => {
        const avgDaily = Number(r.avgDailySalesQty);
        const targetQty =
          avgDaily > 0 ? avgDaily * leadTimeDays * seasonal.value : totalQtyAvailable / list.length;
        return Math.max(0, targetQty - r.qtyAvailable);
      });
      allocations = allocateProportionally(recommendedTotal, weights);
    } else {
      allocations = list.map(() => 0);
    }

    (warehouseStatsByProduct[code] ??= {})[productId] = list.map((r, i) => ({
      warehouseName: r.warehouseName,
      qtyAvailable: r.qtyAvailable,
      avgDailySalesQty: Math.round(Number(r.avgDailySalesQty) * 100) / 100,
      recommendedOrderQty: allocations[i],
    }));
  }

  return (
    <div>
      <h1>Планировщик поставок</h1>
      <p className="muted">
        Отметьте нужные товары, поправьте количество и цену закупки — и
        сразу оформится поставка со всеми позициями.
      </p>
      <PlannerForm
        rows={rows}
        marketplaceStats={marketplaceStats}
        warehouseStatsByProduct={warehouseStatsByProduct}
      />
    </div>
  );
}
