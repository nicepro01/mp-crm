import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import AnalyticsTabs from "../analytics/AnalyticsTabs";
import AllMarketplacesSyncForm from "./AllMarketplacesSyncForm";
import UnattributedSummary from "./UnattributedSummary";
import UnitEconomicsTable, { UnitEconomicsRow } from "./UnitEconomicsTable";
import { getInactiveListingKeys } from "@/lib/activeListings";

export const dynamic = "force-dynamic";

// УСН "доходы" — платим 6% с выплаты от площадки (не с полной цены продажи).
const MARKETPLACE_TAX_RATE = 0.06;
function computeProfitRub(payoutRub: number | null, cogsRub: number): number | null {
  if (payoutRub === null) return null;
  return Math.round((payoutRub * (1 - MARKETPLACE_TAX_RATE) - cogsRub) * 100) / 100;
}

export default async function UnitEconomicsPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => UnitEconomicsPageContent());
}

async function UnitEconomicsPageContent() {
  const [allUnitEconomics, salesAnalytics, inactiveListingKeys, activeListings, marketplaces] = await Promise.all([
    prisma.unitEconomics.findMany({
      // Товары, снятые с продажи целиком (isActive: false), не учитываем ни
      // в одной вкладке — конкретная площадка проверяется отдельно ниже.
      where: { product: { isActive: true } },
      include: { product: true },
      orderBy: { calculatedAt: "desc" },
    }),
    // Продажи здесь не считаются — это отдельная таблица (аналитика по
    // остаткам с площадок). Подтягиваем среднесуточные продажи по тому же
    // магазину, чтобы можно было сортировать и приоритизировать: маржа
    // сама по себе бесполезна без понимания, сколько штук реально продаётся.
    prisma.productStockAnalytics.findMany({
      select: { productId: true, marketplaceId: true, avgDailySalesQty: true, qtyAvailable: true },
    }),
    getInactiveListingKeys(),
    // Активные листинги активных товаров — чтобы найти те, что реально
    // выставлены на площадке, но за период не попали в юнит-экономику
    // (синк пропускает nm_id без продаж, а не «прячет» их).
    prisma.mpListing.findMany({
      where: { isActive: true, product: { isActive: true } },
      select: {
        productId: true,
        product: { select: { sku: true, name: true, photoUrl: true } },
        marketplace: { select: { id: true, code: true, name: true } },
      },
    }),
    // Все магазины компании — источник имён/кодов для вкладок (в отличие от
    // жёстко заданных 3 названий раньше, теперь строк может быть больше, напр.
    // два магазина Ozon) и снимка нераспределённых расходов (unattributedX,
    // эти поля уже лежат прямо на строке Marketplace).
    prisma.marketplace.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        unattributedAmountRub: true,
        unattributedOperations: true,
        unattributedSyncedAt: true,
        unattributedBreakdown: true,
      },
    }),
  ]);
  const marketplaceById = new Map(marketplaces.map((m) => [m.id, m]));

  // Товар может быть снят с продажи именно на этой площадке (MpListing.isActive
  // = false), но жив на других — тогда убираем только эту строку.
  const all = allUnitEconomics.filter(
    (r) => !r.marketplaceId || !inactiveListingKeys.has(`${r.productId}|${r.marketplaceId}`)
  );

  const salesByProductAndMarketplace = new Map<string, number>();
  const stockByProductAndMarketplace = new Map<string, number>();
  for (const s of salesAnalytics) {
    const key = `${s.productId}|${s.marketplaceId}`;
    const prevSales = salesByProductAndMarketplace.get(key) ?? 0;
    salesByProductAndMarketplace.set(key, prevSales + Number(s.avgDailySalesQty));
    const prevStock = stockByProductAndMarketplace.get(key) ?? 0;
    stockByProductAndMarketplace.set(key, prevStock + s.qtyAvailable);
  }

  // Для каждой комбинации товар+магазин+период показываем только последний
  // (самый свежий) расчёт — предыдущие версии остаются в БД как история.
  const latestByKey = new Map<string, (typeof all)[number]>();
  for (const rec of all) {
    const key = `${rec.productId}|${rec.marketplaceId ?? "ALL"}|${rec.periodMonth
      .toISOString()
      .slice(0, 7)}`;
    if (!latestByKey.has(key)) latestByKey.set(key, rec);
  }

  const rows: UnitEconomicsRow[] = Array.from(latestByKey.values()).map((r) => {
    const mp = r.marketplaceId ? marketplaceById.get(r.marketplaceId) : null;
    const avgDailySalesQty = r.marketplaceId
      ? salesByProductAndMarketplace.get(`${r.productId}|${r.marketplaceId}`) ?? 0
      : 0;
    const stockQty = r.marketplaceId
      ? stockByProductAndMarketplace.get(`${r.productId}|${r.marketplaceId}`) ?? 0
      : 0;
    const netMarginRub = Number(r.netMarginRub);
    const payoutRub = r.payoutRub !== null ? Number(r.payoutRub) : null;
    const cogsRub = Number(r.cogsRub);
    const roiPct = cogsRub > 0 ? Math.round((netMarginRub / cogsRub) * 10000) / 100 : null;

    return {
      id: r.id,
      sku: r.product.sku,
      name: r.product.name,
      photoUrl: r.product.photoUrl,
      marketplaceLabel: mp ? mp.name : "Все",
      marketplaceId: r.marketplaceId ?? null,
      period: r.periodMonth.toISOString().slice(0, 7),
      cogsRub,
      mpCommissionRub: Number(r.mpCommissionRub),
      mpCommissionPct: r.mpCommissionPct !== null ? Number(r.mpCommissionPct) : null,
      mpLogisticsRub: Number(r.mpLogisticsRub),
      sellPriceRub: Number(r.sellPriceRub),
      netMarginRub,
      netMarginPct: Number(r.netMarginPct),
      roiPct,
      avgDailySalesQty,
      stockQty,
      profitPerDayRub: Math.round(avgDailySalesQty * netMarginRub * 100) / 100,
      inboundLogisticsRub: Number(r.inboundLogisticsRub),
      acquiringRub: r.acquiringRub !== null ? Number(r.acquiringRub) : null,
      reverseLogisticsRub: r.reverseLogisticsRub !== null ? Number(r.reverseLogisticsRub) : null,
      allocatedOverheadRub: r.allocatedOverheadRub !== null ? Number(r.allocatedOverheadRub) : null,
      storageRub: Number(r.storageRub),
      otherFeesRub: r.otherFeesRub !== null ? Number(r.otherFeesRub) : null,
      adsRub: Number(r.adsRub),
      taxRub: Number(r.taxRub),
      laborAllocRub: Number(r.laborAllocRub),
      buybackPct: r.buybackPct !== null ? Number(r.buybackPct) : null,
      returnsQty: r.returnsQty,
      payoutRub,
      profitRub: computeProfitRub(payoutRub, cogsRub),
      details: (r.details as Record<string, unknown> | null) ?? null,
    };
  });

  // Выплата по каждому магазину для товара — строится один раз по ВСЕМ
  // строкам сразу (не только для "Общей") и используется везде: и на
  // "Общей", и на вкладке каждого конкретного магазина — там это даёт
  // возможность сразу увидеть, как тот же товар выглядит на ДРУГИХ
  // магазинах, не переключаясь на них по отдельности.
  const payoutByMarketplaceBySku = new Map<string, Record<string, number | null>>();
  for (const r of rows) {
    if (!r.marketplaceId) continue;
    const entry = payoutByMarketplaceBySku.get(r.sku) ?? {};
    entry[r.marketplaceId] = r.payoutRub;
    payoutByMarketplaceBySku.set(r.sku, entry);
  }
  for (const r of rows) {
    r.payoutByMarketplace = payoutByMarketplaceBySku.get(r.sku) ?? {};
  }

  // Товар активен и выставлен на площадке (mp_listings.isActive), но за
  // текущий период там не было ни строчки юнит-экономики — либо продаж не
  // было совсем, либо синк для этого магазина ещё не запускали. Показываем
  // это явно, а не молча пропускаем строку — иначе непонятно, куда делся
  // товар из общего количества активных позиций.
  const existingCombos = new Set(
    allUnitEconomics.filter((r) => r.marketplaceId).map((r) => `${r.productId}|${r.marketplaceId}`)
  );
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const seenNoSalesCombos = new Set<string>();
  const noSalesRows: UnitEconomicsRow[] = [];
  for (const l of activeListings) {
    const marketplaceId = l.marketplace.id;
    const comboKey = `${l.productId}|${marketplaceId}`;
    if (existingCombos.has(comboKey) || seenNoSalesCombos.has(comboKey)) continue;
    seenNoSalesCombos.add(comboKey);
    noSalesRows.push({
      id: `nosales-${comboKey}`,
      sku: l.product.sku,
      name: l.product.name,
      photoUrl: l.product.photoUrl,
      marketplaceLabel: l.marketplace.name,
      marketplaceId,
      period: currentPeriod,
      cogsRub: 0,
      mpCommissionRub: 0,
      mpCommissionPct: null,
      mpLogisticsRub: 0,
      sellPriceRub: 0,
      netMarginRub: 0,
      netMarginPct: 0,
      roiPct: null,
      avgDailySalesQty: 0,
      stockQty: stockByProductAndMarketplace.get(comboKey) ?? 0,
      profitPerDayRub: 0,
      inboundLogisticsRub: 0,
      acquiringRub: null,
      reverseLogisticsRub: null,
      allocatedOverheadRub: null,
      storageRub: 0,
      otherFeesRub: null,
      adsRub: 0,
      taxRub: 0,
      laborAllocRub: 0,
      buybackPct: null,
      returnsQty: 0,
      payoutRub: null,
      profitRub: null,
      payoutByMarketplace: payoutByMarketplaceBySku.get(l.product.sku) ?? {},
      details: null,
      noSales: true,
    });
  }

  // "Общая" вкладка — один товар может продаваться в нескольких магазинах
  // сразу, тут агрегируем всё в одну строку, чтобы сразу видеть общую
  // картину, не листая магазины по отдельности. Взвешиваем по среднесуточным
  // продажам — магазин, где товар реально продаётся активнее, должен
  // сильнее влиять на итоговую (среднюю) маржу, чем магазин почти без продаж.
  type ProductAgg = {
    sku: string;
    name: string;
    photoUrl: string | null;
    labels: Set<string>;
    sumSalesQty: number;
    sumStockQty: number;
    sumProfitPerDay: number;
    weightedSellPrice: number;
    weightedMargin: number;
    weightedCommissionRub: number;
    weightedCommissionPct: number;
    weightedLogistics: number;
    weightedReverseLogistics: number;
    weightedStorage: number;
    weightedOtherFees: number;
    weightedPayout: number;
    sumReturnsQty: number;
    cogsRub: number;
    latestPeriod: string;
    // Выплата по каждому конкретному магазину (не взвешенное среднее, а
    // прямое значение той же строки, что показана на вкладке этого
    // магазина) — рядом друг с другом на вкладке "Общая".
    payoutByMarketplace: Record<string, number | null>;
  };
  const byProduct = new Map<string, ProductAgg>();
  for (const r of rows) {
    let agg = byProduct.get(r.sku);
    if (!agg) {
      agg = {
        sku: r.sku,
        name: r.name,
        photoUrl: r.photoUrl,
        labels: new Set(),
        sumSalesQty: 0,
        sumStockQty: 0,
        sumProfitPerDay: 0,
        weightedSellPrice: 0,
        weightedMargin: 0,
        weightedCommissionRub: 0,
        weightedCommissionPct: 0,
        weightedLogistics: 0,
        weightedReverseLogistics: 0,
        weightedStorage: 0,
        weightedOtherFees: 0,
        weightedPayout: 0,
        sumReturnsQty: 0,
        cogsRub: r.cogsRub,
        latestPeriod: r.period,
        payoutByMarketplace: {},
      };
      byProduct.set(r.sku, agg);
    }
    agg.labels.add(r.marketplaceLabel);
    agg.sumSalesQty += r.avgDailySalesQty;
    agg.sumStockQty += r.stockQty;
    agg.sumProfitPerDay += r.profitPerDayRub;
    agg.sumReturnsQty += r.returnsQty;
    // Вес — продажи, а если их совсем нет ни в одном магазине, берём 1 на
    // строку, чтобы получить хотя бы простое среднее вместо деления на 0.
    const weight = r.avgDailySalesQty > 0 ? r.avgDailySalesQty : 0.0001;
    agg.weightedSellPrice += r.sellPriceRub * weight;
    agg.weightedMargin += r.netMarginRub * weight;
    agg.weightedCommissionRub += r.mpCommissionRub * weight;
    agg.weightedCommissionPct += (r.mpCommissionPct ?? 0) * weight;
    agg.weightedLogistics += r.mpLogisticsRub * weight;
    agg.weightedReverseLogistics += (r.reverseLogisticsRub ?? 0) * weight;
    agg.weightedStorage += r.storageRub * weight;
    agg.weightedOtherFees += (r.otherFeesRub ?? 0) * weight;
    agg.weightedPayout += (r.payoutRub ?? 0) * weight;
    if (r.marketplaceId) agg.payoutByMarketplace[r.marketplaceId] = r.payoutRub;
    if (r.period > agg.latestPeriod) agg.latestPeriod = r.period;
  }

  // Товары без единого реального расчёта НИ В ОДНОМ магазине раньше вообще
  // не попадали в "Общую" (byProduct строился только из rows) — из-за этого
  // "Общая" была меньше отдельных вкладок магазинов, хотя должна быть их
  // объединением. Если у товара есть данные хотя бы где-то — просто
  // добавляем магазин без данных в список меток (agg.labels), это уже не
  // "пустышка"; если данных нет вообще нигде — отдельная строка-заглушка,
  // как и на вкладке конкретного магазина.
  type NoDataAgg = { sku: string; name: string; photoUrl: string | null; labels: Set<string>; stockQty: number };
  const noDataBySku = new Map<string, NoDataAgg>();
  for (const r of noSalesRows) {
    const existing = byProduct.get(r.sku);
    if (existing) {
      existing.labels.add(r.marketplaceLabel);
      continue;
    }
    let agg = noDataBySku.get(r.sku);
    if (!agg) {
      agg = { sku: r.sku, name: r.name, photoUrl: r.photoUrl, labels: new Set(), stockQty: 0 };
      noDataBySku.set(r.sku, agg);
    }
    agg.labels.add(r.marketplaceLabel);
    agg.stockQty += r.stockQty;
  }
  const noDataOverallRows: UnitEconomicsRow[] = Array.from(noDataBySku.values()).map((agg) => ({
    id: `agg-nodata-${agg.sku}`,
    sku: agg.sku,
    name: agg.name,
    photoUrl: agg.photoUrl,
    marketplaceLabel: [...agg.labels].sort().join(", "),
    period: currentPeriod,
    cogsRub: 0,
    mpCommissionRub: 0,
    mpCommissionPct: null,
    mpLogisticsRub: 0,
    sellPriceRub: 0,
    netMarginRub: 0,
    netMarginPct: 0,
    roiPct: null,
    avgDailySalesQty: 0,
    stockQty: agg.stockQty,
    profitPerDayRub: 0,
    inboundLogisticsRub: 0,
    acquiringRub: null,
    reverseLogisticsRub: null,
    allocatedOverheadRub: null,
    storageRub: 0,
    otherFeesRub: null,
    adsRub: 0,
    taxRub: 0,
    laborAllocRub: 0,
    buybackPct: null,
    returnsQty: 0,
    payoutRub: null,
    profitRub: null,
    details: null,
    noSales: true,
  }));

  const overallRows: UnitEconomicsRow[] = [
    ...Array.from(byProduct.values()).map((agg) => {
    const totalWeight = agg.sumSalesQty > 0 ? agg.sumSalesQty : agg.labels.size * 0.0001;
    const sellPriceRub = Math.round((agg.weightedSellPrice / totalWeight) * 100) / 100;
    const netMarginRub = Math.round((agg.weightedMargin / totalWeight) * 100) / 100;
    return {
      id: `agg-${agg.sku}`,
      sku: agg.sku,
      name: agg.name,
      photoUrl: agg.photoUrl,
      marketplaceLabel: [...agg.labels].sort().join(", "),
      period: agg.latestPeriod,
      cogsRub: agg.cogsRub,
      mpCommissionRub: Math.round((agg.weightedCommissionRub / totalWeight) * 100) / 100,
      mpCommissionPct: Math.round((agg.weightedCommissionPct / totalWeight) * 100) / 100,
      mpLogisticsRub: Math.round((agg.weightedLogistics / totalWeight) * 100) / 100,
      sellPriceRub,
      netMarginRub,
      netMarginPct: sellPriceRub > 0 ? Math.round((netMarginRub / sellPriceRub) * 10000) / 100 : 0,
      roiPct: agg.cogsRub > 0 ? Math.round((netMarginRub / agg.cogsRub) * 10000) / 100 : null,
      avgDailySalesQty: Math.round(agg.sumSalesQty * 100) / 100,
      stockQty: agg.sumStockQty,
      profitPerDayRub: Math.round(agg.sumProfitPerDay * 100) / 100,
      inboundLogisticsRub: 0,
      acquiringRub: null,
      reverseLogisticsRub: Math.round((agg.weightedReverseLogistics / totalWeight) * 100) / 100,
      allocatedOverheadRub: null,
      storageRub: Math.round((agg.weightedStorage / totalWeight) * 100) / 100,
      otherFeesRub: Math.round((agg.weightedOtherFees / totalWeight) * 100) / 100,
      adsRub: 0,
      taxRub: 0,
      laborAllocRub: 0,
      buybackPct: null,
      returnsQty: agg.sumReturnsQty,
      payoutRub: Math.round((agg.weightedPayout / totalWeight) * 100) / 100,
      profitRub: computeProfitRub(Math.round((agg.weightedPayout / totalWeight) * 100) / 100, agg.cogsRub),
      payoutByMarketplace: agg.payoutByMarketplace,
    };
    }),
    ...noDataOverallRows,
  ];

  const marketplaceIdsPresent = [
    ...new Set([...rows, ...noSalesRows].map((r) => r.marketplaceId).filter((id): id is string => Boolean(id))),
  ];
  const marketplaceTabs = marketplaceIdsPresent.map((marketplaceId) => {
    const mp = marketplaceById.get(marketplaceId);
    const label = mp?.name ?? marketplaceId;
    const tabRows = [
      ...rows.filter((r) => r.marketplaceId === marketplaceId),
      ...noSalesRows.filter((r) => r.marketplaceId === marketplaceId),
    ];
    return {
      key: marketplaceId,
      label: `${label} (${tabRows.length})`,
      content: (
        <>
          {mp?.unattributedAmountRub != null && (
            <UnattributedSummary
              data={{
                amountRub: Number(mp.unattributedAmountRub),
                operations: mp.unattributedOperations ?? 0,
                syncedAt: mp.unattributedSyncedAt?.toISOString() ?? null,
                breakdown:
                  (mp.unattributedBreakdown as Record<
                    string,
                    { amount: number; count: number }
                  > | null) ?? null,
              }}
            />
          )}
          <UnitEconomicsTable rows={tabRows} payoutMarketplaces={mp ? [{ id: mp.id, name: mp.name }] : []} />
        </>
      ),
    };
  });

  return (
    <div>
      <div className="toolbar">
        <h1>Юнит-экономика</h1>
      </div>

      <p className="muted">
        Заголовки столбцов кликабельны — сортируют таблицу, стрелка ▶
        разворачивает полную детализацию по строке.
      </p>
      <AllMarketplacesSyncForm />

      {rows.length === 0 ? (
        <p className="muted">
          Пока нет ни одного расчёта. Добавьте первый — по каждому
          товару/площадке/месяцу здесь будет видна полная структура затрат и
          итоговая маржа.
        </p>
      ) : (
        <AnalyticsTabs
          tabs={[
            {
              key: "overall",
              label: `Общая (${overallRows.length})`,
              content: (
                <UnitEconomicsTable
                  rows={overallRows}
                  showActions={false}
                  payoutMarketplaces={marketplaces.map((m) => ({ id: m.id, name: m.name }))}
                />
              ),
            },
            ...marketplaceTabs,
          ]}
        />
      )}
    </div>
  );
}
