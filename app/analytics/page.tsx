import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import SortableTable, { ClusterRow, SortableColumn } from "./SortableTable";
import AnalyticsTabs from "./AnalyticsTabs";
import ClusterImbalanceSection from "./ClusterImbalanceSection";
import RevenueChartWidget, { ChartScope } from "./RevenueChartWidget";
import TopMoversWidget, { MoverRow, MoverScope } from "./TopMoversWidget";
import AttentionWidget, { AttentionScope } from "./AttentionWidget";
import CreateOrderSection from "./CreateOrderSection";
import SingleMetricChartWidget, { SingleMetricScope } from "./SingleMetricChartWidget";
import { MiniBarChart, ChartBar } from "./MiniChart";
import PriorityFilterTable from "./PriorityFilterTable";
import RecommendationsFilterList from "./RecommendationsFilterList";
import PhotoThumb from "@/app/products/PhotoThumb";
import { getInactiveListingKeys } from "@/lib/activeListings";
import { computeSeasonalIndex, seasonalWeightForWindow } from "@/lib/seasonality";

export const dynamic = "force-dynamic";

// Порог срочности — если остатка не хватит на этот срок, заказывать нужно
// прямо сейчас. Совпадает с целевым покрытием ниже (тот же 120-дневный
// горизонт планирования).
const LEAD_TIME_DAYS = 120;

// Целевое покрытие для расчёта количества заказа — на сколько дней продаж
// вперёд должно хватать остатка + того, что уже едет. Единое значение и
// для отдельных площадок, и для общей сводки.
const TARGET_COVERAGE_DAYS = 120;

// Только для подписей в интерфейсе — фактическое окно задано в каждом
// stock-import/*-sync/route.ts своей константой SALES_WINDOW_DAYS (сейчас у
// всех трёх площадок совпадает, 28 дней); если там поменяют — поправить и
// здесь.
const SALES_WINDOW_DAYS_LABEL = 28;

export default async function AnalyticsPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => AnalyticsPageContent());
}

async function AnalyticsPageContent() {
  const [
    allRows,
    inactiveListingKeys,
    activeListings,
    unitEconomics,
    warehouseAnalytics,
    allProducts,
    openClaimsByProductRaw,
    monthlyTrendRows,
  ] = await Promise.all([
    prisma.productStockAnalytics.findMany({
      // Товары, снятые с продажи целиком (isActive: false), не заказываем и
      // не учитываем ни в одной вкладке аналитики.
      where: { product: { isActive: true } },
      include: {
        product: { select: { sku: true, name: true, photoUrl: true, seasonalDemandMultiplier: true } },
        marketplace: { select: { id: true, name: true, code: true } },
      },
      orderBy: { syncedAt: "desc" },
    }),
    getInactiveListingKeys(),
    // Активные листинги активных товаров — чтобы найти те, что реально
    // выставлены на площадке, но по ним ещё нет ни одной строки остатков
    // (см. плейсхолдеры "нет данных" ниже, тот же приём, что и на
    // странице «Юнит-экономика»).
    prisma.mpListing.findMany({
      where: { isActive: true, product: { isActive: true } },
      select: {
        productId: true,
        product: { select: { sku: true, name: true, photoUrl: true } },
        marketplace: { select: { id: true, code: true, name: true } },
      },
    }),
    // Последний расчёт юнит-экономики на (товар, площадка) — маржа/ROI
    // рядом с остатками, чтобы не гадать, выгоден ли товар, который пора
    // заказывать. Источник истины по марже — страница «Юнит-экономика»,
    // здесь только сводка.
    prisma.unitEconomics.findMany({
      where: { product: { isActive: true }, marketplace: { not: null } },
      orderBy: { calculatedAt: "desc" },
    }),
    // Разбивка по городам/складам — теперь одна и та же модель для всех 3
    // площадок (после исправлений синков в этой сессии), а не только Ozon.
    prisma.productWarehouseAnalytics.findMany({
      where: { product: { isActive: true } },
      select: {
        id: true,
        productId: true,
        marketplaceId: true,
        warehouseName: true,
        qtyAvailable: true,
        avgDailySalesQty: true,
      },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      // purchasePriceRub — последняя известная закупочная цена (та же, что
      // подставляется по умолчанию в Планировщике поставок) — нужна для
      // быстрого создания заказа прямо со вкладки "Пора заказывать" (см.
      // CreateOrderSection ниже), чтобы не заставлять вводить цену вручную,
      // если она уже когда-то была известна.
      select: { id: true, sku: true, name: true, photoUrl: true, purchasePriceRub: true },
    }),
    // Открытые (ещё не решённые) заявки на возврат с WB — см. /returns.
    prisma.returnClaim.groupBy({
      by: ["productId"],
      where: { status: 0, productId: { not: null } },
      _count: true,
    }),
    // Полная история по месяцам (год+месяц, не только текущее окно) — для
    // вкладки «Динамика» ниже. Отдельно от monthlySales дальше по файлу —
    // тот скопирован под сезонность и не содержит year (там достаточно
    // относительного месяца, тут нужен настоящий календарный).
    prisma.productMonthlySales.findMany({
      where: { product: { isActive: true } },
      select: { productId: true, marketplaceId: true, year: true, month: true, qtySold: true },
    }),
  ]);
  const productById = new Map(allProducts.map((p) => [p.id, p]));
  const openClaimsByProduct = new Map(
    openClaimsByProductRaw.filter((c) => c.productId).map((c) => [c.productId as string, c._count])
  );
  // Товар может быть снят с продажи именно на этой площадке (MpListing.isActive
  // = false), но жив на других — тогда убираем только эту конкретную строку,
  // а не весь товар (см. lib/activeListings.ts).
  const rows = allRows.filter((r) => !inactiveListingKeys.has(`${r.productId}|${r.marketplace.code}`));

  // Последний расчёт юнит-экономики на (товар, площадка) — unitEconomics уже
  // отсортирован по calculatedAt desc, поэтому первое попавшееся значение на
  // ключ и есть самое свежее.
  const latestUeByProductMarketplace = new Map<string, (typeof unitEconomics)[number]>();
  for (const ue of unitEconomics) {
    if (!ue.marketplace) continue;
    const key = `${ue.productId}|${ue.marketplace}`;
    if (!latestUeByProductMarketplace.has(key)) latestUeByProductMarketplace.set(key, ue);
  }
  function marginFields(productId: string, marketplaceCode: string) {
    const ue = latestUeByProductMarketplace.get(`${productId}|${marketplaceCode}`);
    if (!ue)
      return {
        cogsRub: null,
        netMarginRub: null,
        netMarginPct: null,
        roiPct: null,
        sellPriceRub: null,
        roasX: null,
        cpoRub: null,
        drrPct: null,
        orderedQty: null,
        returnsQty: null,
        payoutRub: null,
        buybackPct: null,
      };
    const cogsRub = Number(ue.cogsRub);
    const netMarginRub = Number(ue.netMarginRub);
    const sellPriceRub = Number(ue.sellPriceRub);
    const adsRub = Number(ue.adsRub);
    const quantitySold = Number((ue.details as Record<string, unknown> | null)?.quantitySold ?? 0);
    return {
      cogsRub,
      netMarginRub,
      netMarginPct: Number(ue.netMarginPct),
      roiPct: cogsRub > 0 ? Math.round((netMarginRub / cogsRub) * 10000) / 100 : null,
      sellPriceRub,
      // ROAS — выручка на 1 рубль рекламы (revenue / ad spend), в разах, а
      // не в процентах — так его обычно и читают ("×5" нагляднее "500%",
      // легче не спутать с маржой). Null, если на товар вообще не тратили
      // на рекламу за период — не "ROAS = 0", а "рекламы не было".
      roasX: adsRub > 0 ? Math.round((sellPriceRub / adsRub) * 100) / 100 : null,
      // CPO — расход на рекламу в пересчёте на 1 проданную штуку за период
      // (adsRub уже посчитан именно так в юнит-экономике — расход за период
      // делённый на штуки, см. sync-wb/sync-ozon/sync-yandex). Null, если
      // рекламы не было вообще — не "CPO = 0", а "нет данных".
      cpoRub: adsRub > 0 ? Math.round(adsRub * 100) / 100 : null,
      // ДРР (доля рекламных расходов) — расход на рекламу в % от выручки на
      // ту же единицу товара, обратная величина ROAS, но в привычном для
      // рекламных кабинетов виде (%, а не "×").
      drrPct: adsRub > 0 && sellPriceRub > 0 ? Math.round((adsRub / sellPriceRub) * 10000) / 100 : null,
      // Заказано = продано + возвращено за тот же период юнит-экономики —
      // покупатель изначально оформил заказ на эту штуку, часть потом
      // вернулась (returnsQty — тот же столбец, что и на вкладке «Возвраты»,
      // реальные данные из финотчёта площадки, не оценка).
      orderedQty: quantitySold + ue.returnsQty,
      returnsQty: ue.returnsQty,
      // Выплата от площадки — сколько реально остаётся с 1 шт после ВСЕХ
      // удержаний площадки (комиссия, логистика, хранение, реклама,
      // эквайринг, обратная логистика и т.д. — уже вычтены, одинаково для
      // всех 3 площадок, см. sync-wb/sync-ozon/sync-yandex), из последнего
      // расчёта юнит-экономики. Не то же самое, что "Прибыль с 1 шт" — там
      // из выплаты ещё вычтена себестоимость (это не расход площадки, а
      // закупка).
      payoutRub: ue.payoutRub !== null ? Number(ue.payoutRub) : null,
      // % выкупа — реальный сигнал с площадки (WB: заказы старше лага минус
      // отменённые/не выкупленные на ПВЗ; Яндекс: доставлено ÷ (доставлено +
      // невыкуплено), см. sync-wb/sync-yandex), не оценка. У Ozon пока нет
      // сопоставимого сигнала (площадка не отдаёт отдельно неоплаченные
      // заказы) — null, а не 0.
      buybackPct: ue.buybackPct !== null ? Number(ue.buybackPct) : null,
    };
  }

  // Площадка по id — нужно для разбивки по складам ниже (та хранит только
  // marketplaceId) и для «Динамики» (у ProductMonthlySales тоже только id).
  const marketplaceCodeById = new Map<string, string>();
  for (const l of activeListings) {
    marketplaceCodeById.set(l.marketplace.id, l.marketplace.code);
  }

  // Дефицит/избыток по складу там, где нет официальной категоризации от
  // площадки (Ozon её отдаёт сам в ручном отчёте — см. clusterRows ниже, у
  // WB/Яндекса такого отчёта нет вообще) — та же логика порогов, что и в
  // остальной аналитике: не хватит на LEAD_TIME_DAYS — дефицит, продаж нет
  // совсем при живом остатке (или хватит на утроенный горизонт и больше) —
  // избыток. Это ОЦЕНКА по остатку/скорости продаж, а не факт от площадки.
  function classifyLiquidity(qtyAvailable: number, avgDaily: number, daysOfStockLeft: number | null): string | null {
    if (daysOfStockLeft !== null && daysOfStockLeft <= LEAD_TIME_DAYS) return "Дефицитный";
    if (avgDaily === 0 && qtyAvailable > 0) return "Избыточный";
    if (daysOfStockLeft !== null && daysOfStockLeft > LEAD_TIME_DAYS * 3) return "Избыточный";
    return null;
  }

  // Оборачиваемость склада, раз/год — сколько раз в год "прокрутится" текущий
  // остаток при нынешней скорости продаж (365 ÷ "дней до конца", т.е. по
  // сути та же величина, что "Дней до конца", но в привычной для финансов
  // форме "N раз в год"). Это ОЦЕНКА по текущему снимку остатка/скорости, не
  // усреднение по историческим остаткам (истории остатков по дням в базе
  // нет) — полезна прежде всего в среднем по площадке/группе, не построчно.
  function turnoverPerYear(daysOfStockLeft: number | null): number | null {
    return daysOfStockLeft !== null && daysOfStockLeft > 0 ? Math.round((365 / daysOfStockLeft) * 100) / 100 : null;
  }

  // Разбивка по городам/складам — теперь единая для всех 3 площадок (WB,
  // Ozon, Яндекс), а не только Ozon через старую ProductClusterAnalytics.
  // Заодно копим тот же набор строк в формате для вкладки "По регионам" (см.
  // buildMarketplaceSection ниже) — там, где у площадки нет своего отчёта.
  const warehouseBreakdownByMarketplaceCode: Record<string, Record<string, ClusterRow[]>> = {};
  const heuristicRegionRowsByCode: Record<
    string,
    { id: string; productId: string; clusterName: string; qtyAvailable: number; avgDailySalesQty: number; daysOfStockLeft: number | null; liquidityStatus: string | null; product: { sku: string; name: string; photoUrl: string | null } }[]
  > = {};
  for (const w of warehouseAnalytics) {
    const code = marketplaceCodeById.get(w.marketplaceId);
    if (!code) continue;
    const avgDaily = Number(w.avgDailySalesQty);
    const daysOfStockLeft = avgDaily > 0 ? Math.round(w.qtyAvailable / avgDaily) : null;

    const byProduct = warehouseBreakdownByMarketplaceCode[code] ?? (warehouseBreakdownByMarketplaceCode[code] = {});
    const list = byProduct[w.productId] ?? (byProduct[w.productId] = []);
    list.push({
      id: w.id,
      clusterName: w.warehouseName,
      qtyAvailable: w.qtyAvailable,
      avgDailySalesQty: avgDaily,
      daysOfStockLeft,
      liquidityStatus: null,
    });

    if (code !== "OZON") {
      const product = productById.get(w.productId);
      if (!product) continue;
      const regionList = heuristicRegionRowsByCode[code] ?? (heuristicRegionRowsByCode[code] = []);
      regionList.push({
        id: w.id,
        productId: w.productId,
        clusterName: w.warehouseName,
        qtyAvailable: w.qtyAvailable,
        avgDailySalesQty: avgDaily,
        daysOfStockLeft,
        liquidityStatus: classifyLiquidity(w.qtyAvailable, avgDaily, daysOfStockLeft),
        product,
      });
    }
  }

  // Индекс сезонности по товару из накопленной истории продаж — там, где
  // данных достаточно, используется вместо ручного seasonalDemandMultiplier
  // с карточки товара (см. lib/seasonality.ts).
  const monthlySales = await prisma.productMonthlySales.findMany({
    where: { productId: { in: [...new Set(rows.map((r) => r.productId))] } },
    select: { productId: true, month: true, qtySold: true, daysInPeriod: true },
  });
  const monthlySalesByProduct = new Map<string, typeof monthlySales>();
  for (const m of monthlySales) {
    const list = monthlySalesByProduct.get(m.productId) ?? [];
    list.push(m);
    monthlySalesByProduct.set(m.productId, list);
  }
  const seasonalIndexByProduct = new Map(
    [...monthlySalesByProduct.entries()].map(([productId, mRows]) => [
      productId,
      computeSeasonalIndex(mRows),
    ])
  );
  const today = new Date();
  function effectiveSeasonalMultiplier(productId: string, manualMultiplier: number, horizonDays: number) {
    const index = seasonalIndexByProduct.get(productId);
    if (!index || index.size === 0) return { value: manualMultiplier, fromHistory: false };
    return { value: seasonalWeightForWindow(index, today, horizonDays), fromHistory: true };
  }

  if (rows.length === 0) {
    return (
      <div>
        <h1>Аналитика</h1>
        <p className="muted">
          Пока нет данных. Загрузите отчёт «Оборачиваемость» на странице{" "}
          <a href="/stock-import">«Импорт остатков»</a> в блоке аналитики
          нужной площадки.
        </p>
      </div>
    );
  }

  // Сколько уже едет из Китая по каждому товару — партии, которые ещё не
  // отмечены как полностью принятые на склад. Это уже общее число на товар
  // (не на площадку) — заказ в Китай один на все каналы продаж.
  const inTransitByProduct = await prisma.batchItem.groupBy({
    by: ["productId"],
    where: {
      productId: { in: rows.map((r) => r.productId) },
      batch: { logisticsStatus: { not: "RECEIVED" } },
    },
    _sum: { qty: true },
  });
  const inTransitMap = new Map(
    inTransitByProduct.map((b) => [b.productId, b._sum.qty ?? 0])
  );

  // Разбивка по регионам (кластерам) Ozon с признаком дефицит/избыток — из
  // ручного отчёта "Оборачиваемость", только для отдельной вкладки "По
  // регионам (Ozon)" ниже (разворот внутри вкладок площадок теперь общий,
  // см. warehouseBreakdownByMarketplaceCode выше).
  const clusterRows = await prisma.productClusterAnalytics.findMany({
    where: { marketplace: { code: "OZON" }, productId: { in: rows.map((r) => r.productId) } },
    include: { product: { select: { sku: true, name: true, photoUrl: true } } },
  });
  // Построчно на пару (товар, площадка) — как показывалось раньше, теперь
  // используется только для отдельных вкладок по каждой площадке.
  const perListingRows = rows.map((r) => {
    const qtyInTransit = inTransitMap.get(r.productId) ?? 0;
    const avgDaily = Number(r.avgDailySalesQty);
    const seasonal = effectiveSeasonalMultiplier(
      r.productId,
      Number(r.product?.seasonalDemandMultiplier ?? 1),
      TARGET_COVERAGE_DAYS
    );
    const neededForCoverage = avgDaily * TARGET_COVERAGE_DAYS * seasonal.value;
    const recommendedOrderQtyRaw = Math.ceil(neededForCoverage - r.qtyAvailable - qtyInTransit);
    const recommendedOrderQty = Math.max(0, recommendedOrderQtyRaw);
    // Раньше "пора заказывать" смотрело только на голый остаток на складе
    // (daysOfStockLeft <= LEAD_TIME_DAYS), не видя того, что уже едет из
    // Китая — товар с малым остатком, но большой партией в пути, всё равно
    // попадал в "требует внимания". Теперь используем ту же формулу, что и
    // recommendedOrderQty (учитывает остаток + то, что в пути + сезонность):
    // если этого хватает на TARGET_COVERAGE_DAYS вперёд, заказывать рано.
    const needsReorder = recommendedOrderQtyRaw > 0;
    // Реальный признак неликвида есть только там, где загружали ручной отчёт
    // Ozon «Оборачиваемость» (liquidityStatus/daysWithoutSales) — для
    // остального (WB, Яндекс, и Ozon-товары вне того файла) считаем сами по
    // API-данным: продаж нет совсем, а остаток лежит.
    const hasRealDeadStockSignal = r.liquidityStatus !== null || r.daysWithoutSales !== null;
    const isDeadStock = hasRealDeadStockSignal
      ? r.liquidityStatus === "Избыточный" || r.liquidityStatus === "Без продаж" || (r.daysWithoutSales ?? 0) >= 14
      : avgDaily === 0 && r.qtyAvailable > 0;

    return {
      id: r.id,
      productId: r.productId,
      marketplaceCode: r.marketplace.code,
      sku: r.product?.sku ?? r.mpSku,
      name: r.product?.name ?? "—",
      photoUrl: r.product?.photoUrl ?? null,
      qtyAvailable: r.qtyAvailable,
      qtyInTransit,
      avgDailySalesQty: avgDaily,
      avgPriceRub: r.avgPriceRub ? Number(r.avgPriceRub) : null,
      daysOfStockLeft: r.daysOfStockLeft,
      daysWithoutSales: r.daysWithoutSales,
      recommendedOrderQty: recommendedOrderQty > 0 ? recommendedOrderQty : null,
      liquidityStatus: r.liquidityStatus,
      syncedAt: r.syncedAt.toISOString(),
      needsReorder,
      isDeadStock,
      isDeadStockEstimated: !hasRealDeadStockSignal,
      turnoverPerYear: turnoverPerYear(r.daysOfStockLeft),
      noData: false,
      // Последняя известная закупочная цена товара (не по площадке — заказ
      // в Китай один на все каналы продаж) — подставляется по умолчанию при
      // создании заказа прямо со вкладки "Пора заказывать" (см. CreateOrderSection).
      purchasePriceRub: productById.get(r.productId)?.purchasePriceRub
        ? Number(productById.get(r.productId)!.purchasePriceRub)
        : null,
      ...marginFields(r.productId, r.marketplace.code),
    };
  });

  // Товар выставлен активно на площадке, но по нему ещё ни разу не было
  // строки остатков (синк ещё не запускали / нет данных от API) — раньше
  // такие товары молча пропадали из счётчика вкладки конкретной площадки,
  // расходясь со страницей «Товары». Показываем явной строкой-плейсхолдером
  // с пометкой «нет данных», тот же приём, что и на «Юнит-экономике».
  const existingListingCombos = new Set(rows.map((r) => `${r.productId}|${r.marketplace.code}`));
  const seenNoDataCombos = new Set<string>();
  const noDataRows: typeof perListingRows = [];
  for (const l of activeListings) {
    const code = l.marketplace.code;
    const comboKey = `${l.productId}|${code}`;
    if (existingListingCombos.has(comboKey) || seenNoDataCombos.has(comboKey)) continue;
    seenNoDataCombos.add(comboKey);
    noDataRows.push({
      id: `nodata-${comboKey}`,
      productId: l.productId,
      marketplaceCode: code,
      sku: l.product.sku,
      name: l.product.name,
      photoUrl: l.product.photoUrl,
      qtyAvailable: 0,
      qtyInTransit: inTransitMap.get(l.productId) ?? 0,
      avgDailySalesQty: 0,
      // Раньше это показывалось отдельной колонкой "Статус" — её убрали,
      // теперь этот же маркер "нет данных" ставим в колонку "Цена", она у
      // таких строк и так всегда пустая.
      avgPriceRub: "Нет данных" as any,
      daysOfStockLeft: null,
      daysWithoutSales: null,
      recommendedOrderQty: null,
      liquidityStatus: null,
      syncedAt: "",
      needsReorder: false,
      isDeadStock: false,
      isDeadStockEstimated: false,
      turnoverPerYear: null,
      noData: true,
      purchasePriceRub: productById.get(l.productId)?.purchasePriceRub
        ? Number(productById.get(l.productId)!.purchasePriceRub)
        : null,
      // Синк юнит-экономики иногда матчит товар напрямую по артикулу, минуя
      // MpListing (см. sync-yandex) — маржа может быть посчитана, даже если
      // строки остатков для этой площадки ещё нет.
      ...marginFields(l.productId, code),
    });
  }

  // Список площадок, по которым реально есть данные (включая только
  // плейсхолдеры) — вкладки под них формируются автоматически, без
  // хардкода конкретных названий.
  const marketplaceCodes: string[] = [
    ...new Set([...rows.map((r): string => r.marketplace.code), ...noDataRows.map((r) => r.marketplaceCode)]),
  ];
  const marketplaceNameByCode = new Map<string, string>([
    ...rows.map((r): readonly [string, string] => [r.marketplace.code, r.marketplace.name]),
    ...activeListings.map((l): readonly [string, string] => [l.marketplace.code, l.marketplace.name]),
  ]);

  // Единый набор колонок для всех сводных под-вкладок площадки (Все товары/
  // Пора заказывать/Неликвид) — строка уже одна на конкретную площадку,
  // поэтому маржа/ROI/себестоимость прямые (не взвешенные по площадкам, как
  // было в старой сводной вкладке "Все товары").
  // Явная ширина каждой колонки (px) — вместе с dense=true на SortableTable
  // (см. stockTable ниже) заставляет таблицу уложиться в ширину экрана без
  // горизонтального скролла страницы, даже с полутора десятками колонок.
  const perMarketplaceColumns: SortableColumn[] = [
    { key: "photoUrl", label: "", type: "photo", width: 52 },
    { key: "sku", label: "SKU", type: "string", description: "Внутренний SKU товара в CRM", width: 76, noWrap: true },
    { key: "name", label: "Товар", type: "string", description: "Название товара с площадки", width: 148 },
    { key: "qtyAvailable", label: "Остаток", type: "number", description: "Текущий остаток на площадке, все склады/города вместе", width: 52 },
    { key: "qtyInTransit", label: "Уже едет", type: "number", description: "Сколько уже заказано в Китае и едет, но ещё не оприходовано на склад (не привязано к конкретной площадке — заказ один на все каналы продаж)", width: 52 },
    { key: "avgDailySalesQty", label: "Продаж/день", type: "number", description: `Средняя скорость продаж за последние ${SALES_WINDOW_DAYS_LABEL} дней`, width: 56 },
    { key: "daysOfStockLeft", label: "Дней до конца", type: "number", description: "Остаток ÷ продаж/день — через сколько дней товар закончится при нынешнем темпе", width: 56 },
    { key: "turnoverPerYear", label: "Оборот в год", type: "number", description: "Оборачиваемость — 365 ÷ «Дней до конца», сколько раз в год «прокрутится» текущий остаток при нынешней скорости продаж. Оценка по текущему снимку остатка/скорости, не по историческим остаткам (их в базе нет). Пусто — товар не продаётся совсем (нечего оборачивать)", width: 64, noWrap: true },
    { key: "recommendedOrderQty", label: "Заказать, шт", type: "number", description: `Сколько штук заказать, чтобы хватило на ${TARGET_COVERAGE_DAYS} дней вперёд с учётом остатка, того, что уже едет, и сезонности`, width: 56 },
    { key: "cogsRub", label: "Себест., ₽", type: "number", description: "Закупочная себестоимость 1 шт (из карточки товара)", width: 54 },
    { key: "avgPriceRub", label: "Цена, ₽", type: "number", description: "Средняя цена продажи за то же окно, что и скорость продаж. «Нет данных» — товар выставлен на площадке, но остатки/продажи ещё ни разу не синхронизировались", width: 52 },
    { key: "orderedQty", label: "Заказано, шт", type: "number", description: "Продано + возвращено за период последнего расчёта юнит-экономики (см. вкладку «Возвраты») — сколько всего штук оформили покупатели", width: 54 },
    { key: "returnsQty", label: "Возвращено, шт", type: "number", description: "Возвращено за тот же период — из последнего расчёта юнит-экономики (реальные данные из финотчёта площадки)", width: 54 },
    { key: "buybackPct", label: "% выкупа", type: "number", description: "Доля заказов, которые покупатель реально забрал и оплатил (не отменил/не отказался на ПВЗ) — реальный сигнал с площадки, не оценка. Пусто — площадка не отдаёт такие данные (сейчас только WB и Яндекс.Маркет)", width: 48 },
    { key: "netMarginRub", label: "Прибыль с 1 шт, ₽", type: "number", description: "Чистая прибыль с одной проданной штуки — из последнего расчёта юнит-экономики (см. страницу «Юнит-экономика»)", width: 62 },
    { key: "netMarginPct", label: "Маржа, %", type: "number", description: "Прибыль с 1 шт в процентах от цены продажи", width: 46 },
    { key: "roiPct", label: "ROI, %", type: "number", description: "Прибыль с 1 шт в процентах от себестоимости — отдача на вложенный в закупку рубль", width: 44 },
    { key: "roasX", label: "ROAS, ×", type: "number", description: "Выручка на 1 ₽ рекламы за тот же период (×5 — на каждый вложенный рубль вернулось 5); пусто — рекламу не показывали", width: 44 },
    { key: "cpoRub", label: "CPO, ₽", type: "number", description: "Расход на рекламу в пересчёте на 1 проданную штуку за период (cost per order); пусто — рекламу не показывали", width: 46 },
    { key: "drrPct", label: "ДРР, %", type: "number", description: "Доля рекламных расходов — расход на рекламу в % от цены продажи за ту же единицу товара (обратная величина ROAS, в привычном для рекламных кабинетов виде)", width: 44 },
    { key: "abcTier", label: "ABC", type: "string", description: "Группа по вкладу в выручку за период юнит-экономики (см. вкладку «ABC-анализ»): A — первые 80% накопленной выручки, B — следующие 15% (80-95%), C — остальные 5%. Пусто — по товару за период не было выручки", width: 32 },
  ];

  // «Динамика» — продажи по последним 6 ПОЛНЫМ календарным месяцам (не
  // считая текущий, он ещё не закрыт) — растёт товар или падает, отдельно на
  // каждой площадке. Тот же принцип "последний закрытый месяц", что и в
  // sync-yandex для юнит-экономики.
  const MONTH_NAMES_SHORT = [
    "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек",
  ];
  function monthsAgo(n: number): { year: number; month: number } {
    const d = new Date(today.getFullYear(), today.getMonth() - n, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }
  const trendMonths = [6, 5, 4, 3, 2, 1].map((n) => monthsAgo(n));
  const trendColumns: SortableColumn[] = [
    { key: "photoUrl", label: "", type: "photo" },
    { key: "sku", label: "SKU", type: "string", description: "Внутренний SKU товара в CRM" },
    { key: "name", label: "Товар", type: "string", description: "Название товара с площадки" },
    ...trendMonths.map((m, i) => ({
      key: `m${i}`,
      label: `${MONTH_NAMES_SHORT[m.month - 1]} ${m.year}`,
      type: "number" as const,
      description: "Штук продано на этой площадке за весь календарный месяц",
    })),
    {
      key: "trendPct",
      label: "Тренд, %",
      type: "number" as const,
      description: "Изменение продаж последнего месяца к предыдущему: (последний − предыдущий) / предыдущий × 100",
    },
  ];

  const qtyByProductMarketplaceMonth = new Map<string, number>();
  for (const m of monthlyTrendRows) {
    const code = marketplaceCodeById.get(m.marketplaceId);
    if (!code) continue;
    const key = `${m.productId}|${code}|${m.year}-${m.month}`;
    qtyByProductMarketplaceMonth.set(key, (qtyByProductMarketplaceMonth.get(key) ?? 0) + m.qtySold);
  }

  // XYZ-классификация — насколько ровно (без скачков) продаётся товар, в
  // дополнение к ABC (который смотрит только на долю в выручке, но не на
  // стабильность спроса). X — коэффициент вариации месячных продаж ≤10%
  // (стабильный спрос), Y — 10-25% (умеренные колебания), Z — >25%
  // (нестабильный/сезонный/эпизодический спрос). Считаем по тем же 6
  // последним полным месяцам, что и «Динамика» этой же площадки — если
  // известно меньше 3 месяцев истории, классификация ненадёжна (null).
  function xyzTierFor(productId: string, code: string): "X" | "Y" | "Z" | null {
    const monthly = trendMonths
      .map((m) => qtyByProductMarketplaceMonth.get(`${productId}|${code}|${m.year}-${m.month}`))
      .filter((v): v is number => v !== undefined);
    if (monthly.length < 3) return null;
    const mean = monthly.reduce((sum, v) => sum + v, 0) / monthly.length;
    if (mean <= 0) return null;
    const variance = monthly.reduce((sum, v) => sum + (v - mean) ** 2, 0) / monthly.length;
    const cvPct = (Math.sqrt(variance) / mean) * 100;
    if (cvPct <= 10) return "X";
    if (cvPct <= 25) return "Y";
    return "Z";
  }

  function buildTrendRows(code: string): Record<string, unknown>[] {
    const productIds = new Set(
      monthlyTrendRows.filter((m) => marketplaceCodeById.get(m.marketplaceId) === code).map((m) => m.productId)
    );
    return [...productIds]
      .map((productId) => {
        const product = productById.get(productId);
        if (!product) return null;
        const monthly = trendMonths.map(
          (m) => qtyByProductMarketplaceMonth.get(`${productId}|${code}|${m.year}-${m.month}`) ?? 0
        );
        const totalQty = monthly.reduce((sum, q) => sum + q, 0);
        if (totalQty === 0) return null; // нет продаж вообще за окно — не загромождаем таблицу нулями

        const last = monthly[monthly.length - 1];
        const prev = monthly[monthly.length - 2];
        const trendPct = prev > 0 ? Math.round(((last - prev) / prev) * 10000) / 100 : null;

        const row: Record<string, unknown> = {
          id: productId,
          sku: product.sku,
          name: product.name,
          photoUrl: product.photoUrl,
          trendPct,
        };
        monthly.forEach((q, i) => {
          row[`m${i}`] = q;
        });
        return row;
      })
      .filter((r): r is Record<string, unknown> => r !== null);
  }

  // «Возвраты» — сводка по товару на конкретной площадке: факт возвратов (из
  // юнит-экономики этой площадки) + открытые заявки WB (полная детализация —
  // на /returns, сюда дублировать таблицу заявок незачем; у Ozon/Яндекса
  // такого отдельного workflow заявок пока нет — колонку не показываем).
  const returnColumnsBase: SortableColumn[] = [
    { key: "photoUrl", label: "", type: "photo" },
    { key: "sku", label: "SKU", type: "string", description: "Внутренний SKU товара в CRM" },
    { key: "name", label: "Товар", type: "string", description: "Название товара с площадки" },
    { key: "quantitySold", label: "Продано за период, шт", type: "number", description: "Из последнего расчёта юнит-экономики этой площадки" },
    { key: "returnsQty", label: "Возвращено, шт", type: "number", description: "Фактические возвраты за тот же период (из финансового отчёта площадки)" },
    { key: "returnPct", label: "% возврата", type: "number", description: "Возвращено ÷ (продано + возвращено) × 100" },
  ];
  const openClaimsColumn: SortableColumn = {
    key: "openClaimsWb",
    label: "Открытых заявок (WB)",
    type: "number",
    description: "Сколько заявок на возврат сейчас висит нерешённых — живой снимок, не за период. Детали — на странице «Возвраты»",
  };

  function buildReturnRows(code: string): { id: string; sku: string; name: string; photoUrl: string | null; quantitySold: number; returnsQty: number; returnPct: number | null; openClaimsWb: number }[] {
    const result: ReturnType<typeof buildReturnRows> = [];
    for (const [key, ue] of latestUeByProductMarketplace) {
      if (ue.marketplace !== code) continue;
      const openClaimsWb = code === "WB" ? openClaimsByProduct.get(ue.productId) ?? 0 : 0;
      if (ue.returnsQty <= 0 && openClaimsWb <= 0) continue;
      const product = productById.get(ue.productId);
      if (!product) continue;
      const quantitySold = Number((ue.details as Record<string, unknown> | null)?.quantitySold ?? 0);
      const denominator = quantitySold + ue.returnsQty;
      result.push({
        id: key,
        sku: product.sku,
        name: product.name,
        photoUrl: product.photoUrl,
        quantitySold,
        returnsQty: ue.returnsQty,
        returnPct: denominator > 0 ? Math.round((ue.returnsQty / denominator) * 10000) / 100 : null,
        openClaimsWb,
      });
    }
    return result;
  }

  // ABC-анализ одной площадки — товары по вкладу в выручку за тот же период,
  // что и остальная юнит-экономика: A — первые 80% накопленной выручки, B —
  // следующие 15% (80-95%), C — оставшиеся 5%. Классическое разбиение
  // Парето. Вынесено отдельной функцией — используется и в детальной
  // вкладке ABC на площадке, и в сводке на дашборде (см. buildDashboardSection).
  type AbcRow = {
    id: string;
    sku: string;
    name: string;
    photoUrl: string | null;
    revenueRub: number;
    sharePct: number;
    cumulativePct: number;
    tier: "A" | "B" | "C";
  };
  function buildAbcRows(code: string): AbcRow[] {
    const items: { productId: string; sku: string; name: string; photoUrl: string | null; revenueRub: number }[] = [];
    for (const ue of latestUeByProductMarketplace.values()) {
      if (ue.marketplace !== code) continue;
      const product = productById.get(ue.productId);
      if (!product) continue;
      const quantitySold = Number((ue.details as Record<string, unknown> | null)?.quantitySold ?? 0);
      const revenueRub = Number(ue.sellPriceRub) * quantitySold;
      if (revenueRub <= 0) continue;
      items.push({ productId: ue.productId, sku: product.sku, name: product.name, photoUrl: product.photoUrl, revenueRub });
    }
    items.sort((a, b) => b.revenueRub - a.revenueRub);
    const totalRevenue = items.reduce((sum, i) => sum + i.revenueRub, 0);
    let cumulativeRevenue = 0;
    return items.map((item) => {
      cumulativeRevenue += item.revenueRub;
      const sharePct = totalRevenue > 0 ? Math.round((item.revenueRub / totalRevenue) * 10000) / 100 : 0;
      const cumulativePct = totalRevenue > 0 ? Math.round((cumulativeRevenue / totalRevenue) * 10000) / 100 : 0;
      const tier: "A" | "B" | "C" = cumulativePct <= 80 ? "A" : cumulativePct <= 95 ? "B" : "C";
      return {
        id: item.productId,
        sku: item.sku,
        name: item.name,
        photoUrl: item.photoUrl,
        revenueRub: Math.round(item.revenueRub * 100) / 100,
        sharePct,
        cumulativePct,
        tier,
      };
    });
  }

  // Полный раздел на каждую площадку — раньше часть вкладок (Все товары,
  // Пора заказывать и т.д.) была общей сразу для всех 3 площадок, что
  // смешивало цифры и не давало понять, что происходит конкретно на WB или
  // Ozon. Теперь площадка — это цельный раздел со своими под-вкладками.
  function buildMarketplaceSection(code: string) {
    // Считаем ABC один раз на площадку — используется и как отдельный
    // столбец "ABC" в "Все товары"/"Пора заказывать", и как детальная
    // вкладка "ABC-анализ" ниже (с долями/накопленным % и т.д.).
    const abcRows = buildAbcRows(code);
    const abcTierByProductId = new Map(abcRows.map((r) => [r.id, r.tier]));
    const codeRows = [
      ...perListingRows.filter((r) => r.marketplaceCode === code),
      ...noDataRows.filter((r) => r.marketplaceCode === code),
    ].map((r) => ({ ...r, abcTier: abcTierByProductId.get(r.productId) ?? null }));
    const reorderRows = codeRows.filter((r) => r.needsReorder);
    const marketplaceName = marketplaceNameByCode.get(code) ?? code;
    // Тот же период, что и у расчёта юнит-экономики (см. sync-wb/sync-ozon/
    // sync-yandex) — используется и в «Возвраты», и в «ABC-анализ» ниже, оба
    // считаются от того же ue.
    const uePeriodLabel =
      code === "WB"
        ? "последние 30 дней"
        : code === "OZON"
          ? "последние 29 дней"
          : "последний полностью закрытый календарный месяц (не текущий)";

    // Раньше было отдельной колонкой "Обновлено" в каждой строке — убрали
    // (все строки синкаются одним запросом почти одновременно, разница по
    // товару непринципиальна), вместо неё одна плашка на все три
    // склад-вкладки сразу с датой последнего синка остатков этой площадки.
    const syncedTimestamps = codeRows.map((r) => r.syncedAt).filter((s): s is string => Boolean(s));
    const lastSyncedAt = syncedTimestamps.length > 0 ? syncedTimestamps.sort().at(-1)! : null;

    // Средняя оборачиваемость склада — в целом по площадке и отдельно по
    // группам ABC (используем уже посчитанный abcTier на codeRows) — по
    // отдельному товару это просто обратная величина "Дней до конца", а вот
    // среднее по группе — самостоятельная сводка, которую иначе не увидеть.
    function avgTurnover(list: typeof codeRows): number | null {
      const values = list.map((r) => turnoverPerYear(r.daysOfStockLeft)).filter((v): v is number => v !== null);
      return values.length > 0 ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100 : null;
    }
    const turnoverOverall = avgTurnover(codeRows);
    const turnoverByTier: Record<"A" | "B" | "C", number | null> = {
      A: avgTurnover(codeRows.filter((r) => r.abcTier === "A")),
      B: avgTurnover(codeRows.filter((r) => r.abcTier === "B")),
      C: avgTurnover(codeRows.filter((r) => r.abcTier === "C")),
    };

    function stockTable(
      tableRows: typeof codeRows,
      sortKey: string,
      sortDir: "asc" | "desc",
      caption: string,
      showTurnoverBadge?: boolean
    ) {
      return (
        <>
          {lastSyncedAt && (
            <div
              className="muted"
              style={{
                display: "inline-block",
                background: "var(--surface-alt)",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 13,
                marginBottom: 8,
                marginRight: 8,
              }}
            >
              Остатки обновлены: {new Date(lastSyncedAt).toLocaleString("ru-RU")}
            </div>
          )}
          {showTurnoverBadge && turnoverOverall !== null && (
            <div
              className="muted"
              style={{
                display: "inline-block",
                background: "var(--surface-alt)",
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 13,
                marginBottom: 8,
              }}
              title="Оценка по текущему снимку остатка и скорости продаж: 365 ÷ «Дней до конца», усреднено по товарам. Не историческое среднее (истории остатков по дням в базе нет)."
            >
              Оборачиваемость склада: в среднем {turnoverOverall}× в год
              {(turnoverByTier.A !== null || turnoverByTier.B !== null || turnoverByTier.C !== null) && (
                <>
                  {" "}
                  (A: {turnoverByTier.A ?? "—"}×, B: {turnoverByTier.B ?? "—"}×, C: {turnoverByTier.C ?? "—"}×)
                </>
              )}
            </div>
          )}
          <p className="muted">{caption}</p>
          <div className="table-scroll">
            <SortableTable
              columns={perMarketplaceColumns}
              rows={tableRows}
              rowKey="id"
              defaultSortKey={sortKey}
              defaultSortDir={sortDir}
              expandKey="productId"
              clustersByKey={warehouseBreakdownByMarketplaceCode[code]}
              expandGroupLabel="Город/склад"
              expandSectionTitle="По городам/складам"
              dense
            />
          </div>
        </>
      );
    }

    // То же самое "Топы/Рекомендации/Пора заказывать по этой площадке", что
    // и внутри вкладки "Рекомендации" (см. buildMarketplaceRecommendationTabs
    // ниже по файлу — но вызывается здесь, а не там, это просто JS-замыкание,
    // реально выполняется только при рендере, к тому моменту всё уже
    // посчитано) — продублировано и здесь, чтобы не уходить со страницы
    // конкретной площадки, чтобы увидеть рекомендации по ней же.
    const subTabs = [
      {
        key: "all",
        label: `Все товары (${codeRows.length})`,
        content: stockTable(
          codeRows,
          "daysOfStockLeft",
          "asc",
          `Текущий остаток и средняя скорость продаж за последние ${SALES_WINDOW_DAYS_LABEL} дней (по данным API площадки). ROAS — выручка на 1 ₽ рекламы за период юнит-экономики (×5 значит на каждый вложенный рубль вернулось 5); пусто — рекламу не показывали.`,
          true
        ),
      },
      {
        key: "reorder",
        label: `Пора заказывать (${reorderRows.length})`,
        content:
          reorderRows.length === 0 ? (
            <p className="muted">Нет товаров, которым срочно нужна новая поставка.</p>
          ) : (
            <>
              {stockTable(
                reorderRows,
                "daysOfStockLeft",
                "asc",
                `Из «Все товары» — те, кому хватит остатка меньше чем на ${LEAD_TIME_DAYS} дней при нынешней скорости продаж (столько в среднем едет новая партия из Китая). Скорость продаж — за последние ${SALES_WINDOW_DAYS_LABEL} дней.`
              )}
              <CreateOrderSection
                rows={reorderRows.filter((r) => !r.noData).map((r) => ({
                  productId: r.productId,
                  sku: r.sku,
                  name: r.name,
                  photoUrl: r.photoUrl,
                  qtyAvailable: r.qtyAvailable,
                  avgDailySalesQty: r.avgDailySalesQty,
                  daysOfStockLeft: r.daysOfStockLeft,
                  recommendedOrderQty: r.recommendedOrderQty,
                  purchasePriceRub: r.purchasePriceRub,
                }))}
              />
            </>
          ),
      },
      {
        key: "recommendations",
        label: "Рекомендации",
        content: <AnalyticsTabs tabs={buildMarketplaceRecommendationTabs(code)} />,
      },
    ];

    // Разбор дефицит/избыток по кластерам/складам — у Ozon из его собственного
    // ручного отчёта "Оборачиваемость" (реальная категоризация liquidityStatus
    // от площадки), у WB/Яндекса такого отчёта нет — статус оценивается сами
    // по остатку/скорости продаж (см. classifyLiquidity выше).
    const regionRows =
      code === "OZON"
        ? clusterRows.map((c) => ({
            id: c.id,
            productId: c.productId,
            clusterName: c.clusterName,
            qtyAvailable: c.qtyAvailable,
            avgDailySalesQty: Number(c.avgDailySalesQty),
            daysOfStockLeft: c.daysOfStockLeft,
            liquidityStatus: c.liquidityStatus,
            product: c.product,
          }))
        : (heuristicRegionRowsByCode[code] ?? []);
    if (regionRows.length > 0) {
      subTabs.push({
        key: "regions",
        label: "По регионам",
        content: (
          <ClusterImbalanceSection
            rows={regionRows}
            estimatedStatus={code !== "OZON"}
            periodNote={
              code === "OZON"
                ? "Период — какой в вручную загруженном отчёте «Оборачиваемость» Ozon (не фиксирован, зависит от того, за что выгружали файл)."
                : `Скорость продаж по складам — за последние ${SALES_WINDOW_DAYS_LABEL} дней, то же окно, что и в остальной аналитике по этой площадке.`
            }
          />
        ),
      });
    }

    const trendRows = buildTrendRows(code);
    subTabs.push({
      key: "trend",
      label: `Динамика (${trendRows.length})`,
      content:
        trendRows.length === 0 ? (
          <p className="muted">
            Пока нет истории продаж по месяцам на этой площадке — накопится
            после нескольких синков юнит-экономики.
          </p>
        ) : (
          <>
            <p className="muted">
              Продажи по последним 6 полным календарным месяцам (текущий не
              считается — он ещё не закрыт). «Тренд» — на сколько изменились
              продажи в последнем месяце к предыдущему: (последний −
              предыдущий) / предыдущий × 100.
            </p>
            <div className="table-scroll">
              <SortableTable
                columns={trendColumns}
                rows={trendRows}
                rowKey="id"
                defaultSortKey="trendPct"
                defaultSortDir="desc"
              />
            </div>
          </>
        ),
    });

    const returnRows = buildReturnRows(code);
    subTabs.push({
      key: "returns",
      label: `Возвраты (${returnRows.length})`,
      content: (
        <>
          <p className="muted">
            «Продано»/«Возвращено» — за {uePeriodLabel}, из того же расчёта
            юнит-экономики, что на странице «Юнит-экономика». Только товары с
            возвратами или открытыми заявками — остальные не показаны.
            {code === "WB" && (
              <>
                {" "}
                «Открытых заявок» — не за период, а сколько заявок на возврат
                висит нерешённых прямо сейчас. Полная детализация заявок (с
                причиной и фото) — на странице <a href="/returns">«Возвраты»</a>.
              </>
            )}
          </p>
          {returnRows.length === 0 ? (
            <p className="muted">Возвратов не найдено.</p>
          ) : (
            <div className="table-scroll">
              <SortableTable
                columns={code === "WB" ? [...returnColumnsBase, openClaimsColumn] : returnColumnsBase}
                rows={returnRows}
                rowKey="id"
                defaultSortKey="returnPct"
                defaultSortDir="desc"
              />
            </div>
          )}
        </>
      ),
    });

    // XYZ — насколько ровно продаётся товар (в дополнение к ABC, который
    // смотрит только на долю в выручке, но не на стабильность спроса) — см.
    // xyzTierFor выше. matrixTier — их пересечение (напр. "AX" — хит с
    // ровным спросом, "CZ" — мелкий и нестабильный, первый кандидат на вывод
    // из ассортимента); если истории меньше 3 месяцев, xyzTier/matrixTier — null.
    const abcXyzRows = abcRows.map((r) => {
      const xyzTier = xyzTierFor(r.id, code);
      return { ...r, xyzTier, matrixTier: xyzTier ? `${r.tier}${xyzTier}` : null };
    });
    const abcColumns: SortableColumn[] = [
      { key: "photoUrl", label: "", type: "photo" },
      { key: "sku", label: "SKU", type: "string", description: "Внутренний SKU товара в CRM" },
      { key: "name", label: "Товар", type: "string", description: "Название товара с площадки" },
      { key: "revenueRub", label: "Выручка за период, ₽", type: "number", description: "Цена продажи × продано штук за период юнит-экономики этой площадки" },
      { key: "sharePct", label: "Доля выручки, %", type: "number", description: "Доля этого товара в общей выручке площадки за период" },
      { key: "cumulativePct", label: "Накоп. %", type: "number", description: "Сумма долей всех товаров от самого крупного до этого включительно (по убыванию выручки) — по ней и определяется группа" },
      { key: "tier", label: "ABC", type: "string", description: "A — первые 80% накопленной выручки, B — следующие 80-95%, C — остальные 5%" },
      { key: "xyzTier", label: "XYZ", type: "string", description: "Стабильность спроса по последним 6 полным месяцам: X — коэфф. вариации ≤10% (ровно), Y — 10-25% (умеренно), Z — >25% (скачками/сезонно). Пусто — меньше 3 месяцев истории" },
      { key: "matrixTier", label: "Группа", type: "string", description: "Пересечение ABC×XYZ, напр. AX — хит со стабильным спросом, CZ — мелкий и нестабильный, первый кандидат на сокращение ассортимента" },
    ];
    const abcCounts = { A: abcRows.filter((r) => r.tier === "A").length, B: abcRows.filter((r) => r.tier === "B").length, C: abcRows.filter((r) => r.tier === "C").length };
    const xyzMatrixCounts: Record<string, number> = {};
    let xyzUnclassifiedCount = 0;
    for (const r of abcXyzRows) {
      if (!r.matrixTier) {
        xyzUnclassifiedCount++;
        continue;
      }
      xyzMatrixCounts[r.matrixTier] = (xyzMatrixCounts[r.matrixTier] ?? 0) + 1;
    }
    subTabs.push({
      key: "abc",
      label: `ABC-анализ (${abcRows.length})`,
      content:
        abcRows.length === 0 ? (
          <p className="muted">Нет данных о выручке за период — появится после синка юнит-экономики.</p>
        ) : (
          <>
            <p className="muted">
              Товары по вкладу в выручку за {uePeriodLabel} (тот же расчёт
              юнит-экономики). <strong>A</strong> — первые 80% накопленной
              выручки ({abcCounts.A} шт), <strong>B</strong> — следующие
              80-95% ({abcCounts.B} шт), <strong>C</strong> — остальные 5%
              ({abcCounts.C} шт). Обычно на A держится основной оборот, а C —
              кандидаты на сокращение ассортимента. <strong>XYZ</strong> —
              стабильность спроса по последним 6 месяцам (X — ровно, Y —
              умеренно, Z — скачками); {xyzUnclassifiedCount} шт пока без
              этой оценки — не хватает истории.
            </p>
            <div className="table-scroll" style={{ marginBottom: 16 }}>
              <table style={{ maxWidth: 480 }}>
                <thead>
                  <tr>
                    <th></th>
                    <th title="Коэфф. вариации ≤10%">X — ровный спрос</th>
                    <th title="Коэфф. вариации 10-25%">Y — умеренный</th>
                    <th title="Коэфф. вариации >25%">Z — скачками</th>
                  </tr>
                </thead>
                <tbody>
                  {(["A", "B", "C"] as const).map((abcTier) => (
                    <tr key={abcTier}>
                      <td style={{ fontWeight: 600 }}>{abcTier}</td>
                      {(["X", "Y", "Z"] as const).map((xyzTier) => (
                        <td key={xyzTier}>{xyzMatrixCounts[`${abcTier}${xyzTier}`] ?? 0}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-scroll">
              <SortableTable columns={abcColumns} rows={abcXyzRows} rowKey="id" defaultSortKey="revenueRub" defaultSortDir="desc" />
            </div>
          </>
        ),
    });

    return {
      key: `mp-${code}`,
      label: `${marketplaceName} (${codeRows.length})`,
      content: <AnalyticsTabs tabs={subTabs} />,
    };
  }

  // ===== Дашборд — сводка по всем площадкам сразу (единственное место на
  // "Аналитике", где цифры намеренно смешаны между площадками — остальная
  // страница специально разложена по разделам площадок, см. историю выше). =====

  // Средняя цена — резервный источник, если для товара на этот месяц нет
  // расчёта юнит-экономики вообще (marginFields вернёт null) — тогда хотя бы
  // выручку оцениваем по текущей цене на площадке, а не пропускаем совсем.
  const avgPriceByProductMarketplace = new Map<string, number>();
  for (const r of rows) {
    if (r.avgPriceRub) avgPriceByProductMarketplace.set(`${r.productId}|${r.marketplace.code}`, Number(r.avgPriceRub));
  }

  function monthKeyPadded(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  function monthLabelFromKey(key: string): string {
    const [y, mm] = key.split("-");
    return `${MONTH_NAMES_SHORT[Number(mm) - 1]} ${y}`;
  }

  // Штуки — реальная история по месяцам (ProductMonthlySales), цена — из
  // последнего расчёта юнит-экономики (или текущей цены, см. выше) — это
  // ОЦЕНКА выручки, реальной истории цены по месяцам в базе нет
  // (юнит-экономика хранит только последний снимок). Копим сразу по
  // площадкам ("ALL" — все вместе, плюс каждый code отдельно) — переключатель
  // на дашборде даёт смотреть и общую картину, и любую площадку в отдельности.
  const revenueByScopeMonth = new Map<string, Map<string, number>>();
  const qtyByScopeMonth = new Map<string, Map<string, number>>();
  // Профит по месяцам — та же оценка (реальные штуки × текущий профит/шт),
  // тот же принцип, что и у выручки выше. Профит/шт = выплата от площадки
  // минус налог (6%, УСН «доходы») минус себестоимость — как на «Юнит-экономике».
  const MARKETPLACE_TAX_RATE = 0.06;
  const profitByScopeMonth = new Map<string, Map<string, number>>();
  const qtyByProductMonthAll = new Map<string, number>(); // для «Топ роста/падения» ниже, не по месяцам-суммам
  function addScopeMonth(map: Map<string, Map<string, number>>, scope: string, monthKey: string, value: number) {
    const inner = map.get(scope) ?? new Map<string, number>();
    inner.set(monthKey, (inner.get(monthKey) ?? 0) + value);
    map.set(scope, inner);
  }
  for (const m of monthlyTrendRows) {
    const code = marketplaceCodeById.get(m.marketplaceId);
    if (!code) continue;
    const productMonthKey = `${m.productId}|${m.year}-${m.month}`;
    qtyByProductMonthAll.set(productMonthKey, (qtyByProductMonthAll.get(productMonthKey) ?? 0) + m.qtySold);

    const monthKey = monthKeyPadded(m.year, m.month);
    const margin = marginFields(m.productId, code);
    const price = margin.sellPriceRub ?? avgPriceByProductMarketplace.get(`${m.productId}|${code}`) ?? 0;
    const revenue = price * m.qtySold;
    addScopeMonth(revenueByScopeMonth, "ALL", monthKey, revenue);
    addScopeMonth(revenueByScopeMonth, code, monthKey, revenue);
    addScopeMonth(qtyByScopeMonth, "ALL", monthKey, m.qtySold);
    addScopeMonth(qtyByScopeMonth, code, monthKey, m.qtySold);

    if (margin.payoutRub !== null) {
      const profitPerUnit = margin.payoutRub * (1 - MARKETPLACE_TAX_RATE) - (margin.cogsRub ?? 0);
      const profit = profitPerUnit * m.qtySold;
      addScopeMonth(profitByScopeMonth, "ALL", monthKey, profit);
      addScopeMonth(profitByScopeMonth, code, monthKey, profit);
    }
  }
  const chartMonthKeys = [...new Set(monthlyTrendRows.map((m) => monthKeyPadded(m.year, m.month)))]
    .sort()
    .slice(-12);
  // Цвета площадок — только для составных столбиков на "Все площадки" ниже,
  // подобраны узнаваемо близко к брендам (WB — фиолетовый, Ozon — синий,
  // Яндекс.Маркет — жёлтый).
  const MARKETPLACE_CHART_COLORS: Record<string, string> = {
    WB: "#9333ea",
    OZON: "#0069ff",
    YANDEX_MARKET: "#f5c518",
  };
  const chartLegend = marketplaceCodes.map((code) => ({
    code,
    label: marketplaceNameByCode.get(code) ?? code,
    color: MARKETPLACE_CHART_COLORS[code] ?? "#9ca3af",
  }));
  function buildAllScopeBar(byScopeMonth: Map<string, Map<string, number>>, key: string) {
    const segments = marketplaceCodes.map((code) => ({
      code,
      label: marketplaceNameByCode.get(code) ?? code,
      value: byScopeMonth.get(code)?.get(key) ?? 0,
      color: MARKETPLACE_CHART_COLORS[code] ?? "#9ca3af",
    }));
    const value = segments.reduce((sum, s) => sum + s.value, 0);
    return { label: monthLabelFromKey(key), value, segments };
  }
  const revenueChartScopes: ChartScope[] = [
    {
      code: "ALL",
      label: "Все площадки",
      legend: chartLegend,
      revenue: chartMonthKeys.map((key) => buildAllScopeBar(revenueByScopeMonth, key)),
      qty: chartMonthKeys.map((key) => buildAllScopeBar(qtyByScopeMonth, key)),
    },
    ...marketplaceCodes.map((code) => ({
      code,
      label: marketplaceNameByCode.get(code) ?? code,
      revenue: chartMonthKeys.map((key) => ({
        label: monthLabelFromKey(key),
        value: revenueByScopeMonth.get(code)?.get(key) ?? 0,
      })),
      qty: chartMonthKeys.map((key) => ({
        label: monthLabelFromKey(key),
        value: qtyByScopeMonth.get(code)?.get(key) ?? 0,
      })),
    })),
  ];

  // Профит по месяцам — тот же принцип оценки (реальные штуки × текущий
  // профит/шт), тот же переключатель площадки, что и у выручки выше, только
  // отдельным графиком (не парой рядом), см. SingleMetricChartWidget.
  const profitChartScopes: SingleMetricScope[] = [
    {
      code: "ALL",
      label: "Все площадки",
      legend: chartLegend,
      data: chartMonthKeys.map((key) => buildAllScopeBar(profitByScopeMonth, key)),
    },
    ...marketplaceCodes.map((code) => ({
      code,
      label: marketplaceNameByCode.get(code) ?? code,
      data: chartMonthKeys.map((key) => ({
        label: monthLabelFromKey(key),
        value: profitByScopeMonth.get(code)?.get(key) ?? 0,
      })),
    })),
  ];

  // Возвраты и отказы — один график, общий знаменатель (%), а не штуки:
  // штуки разных площадок несравнимы напрямую (у кого больше продаж, у того
  // и возвратов в штуках больше), а доля — честно сравнима. Это снимок за
  // текущий период (не история по месяцам — юнит-экономика хранит только
  // последний расчёт).
  const returnsAgg = new Map<string, { returns: number; sold: number }>();
  for (const ue of latestUeByProductMarketplace.values()) {
    if (!ue.marketplace) continue;
    const agg = returnsAgg.get(ue.marketplace) ?? { returns: 0, sold: 0 };
    agg.returns += ue.returnsQty;
    agg.sold += Number((ue.details as Record<string, unknown> | null)?.quantitySold ?? 0);
    returnsAgg.set(ue.marketplace, agg);
  }
  // Отказы (невыкуп заказов) — реальные данные есть только у WB (buybackPct
  // в юнит-экономике, из заказов WB API — см. sync-wb). У Ozon/Яндекса такого
  // отчёта нет вообще, поэтому эта метрика только по WB. Взвешено по штукам
  // проданным за период — крупный товар должен весить больше мелкого.
  let wbRefusalWeightedSum = 0;
  let wbRefusalWeight = 0;
  for (const ue of latestUeByProductMarketplace.values()) {
    if (ue.marketplace !== "WB" || ue.buybackPct === null) continue;
    const qtySold = Number((ue.details as Record<string, unknown> | null)?.quantitySold ?? 0);
    const weight = qtySold > 0 ? qtySold : 1;
    wbRefusalWeightedSum += (100 - Number(ue.buybackPct)) * weight;
    wbRefusalWeight += weight;
  }
  const wbRefusalPct = wbRefusalWeight > 0 ? Math.round((wbRefusalWeightedSum / wbRefusalWeight) * 100) / 100 : null;
  // Короткие подписи для этого графика — полные названия площадок
  // ("Яндекс.Маркет: возврат") при повороте не помещались и обрезались.
  const SHORT_MARKETPLACE_LABEL: Record<string, string> = { WB: "WB", OZON: "Ozon", YANDEX_MARKET: "Яндекс" };
  const returnsRefusalsChartData: ChartBar[] = [
    ...marketplaceCodes.map((code) => {
      const agg = returnsAgg.get(code);
      const denom = agg ? agg.sold + agg.returns : 0;
      const pct = agg && denom > 0 ? Math.round((agg.returns / denom) * 10000) / 100 : 0;
      return { label: `${SHORT_MARKETPLACE_LABEL[code] ?? code} возврат`, value: pct };
    }),
    ...(wbRefusalPct !== null ? [{ label: "WB отказ", value: wbRefusalPct }] : []),
  ];

  // Топ роста/падения — та же логика тренда, что и в «Динамике» отдельной
  // площадки; переключатель на дашборде даёт выбрать "Все площадки сразу"
  // (штуки суммируются по товару) или конкретную (штуки только оттуда).
  function computeTopMovers(
    productIds: Iterable<string>,
    qtyOf: (productId: string, m: { year: number; month: number }) => number
  ): { growth: MoverRow[]; decline: MoverRow[] } {
    const list = [...productIds]
      .map((productId) => {
        const product = productById.get(productId);
        if (!product) return null;
        const monthly = trendMonths.map((m) => qtyOf(productId, m));
        const last = monthly[monthly.length - 1];
        const prev = monthly[monthly.length - 2];
        if (prev <= 0) return null; // нет базы для сравнения — новый спрос или нет истории, не "рост"/"падение"
        const trendPct = Math.round(((last - prev) / prev) * 10000) / 100;
        return { id: productId, sku: product.sku, name: product.name, photoUrl: product.photoUrl, trendPct };
      })
      .filter((r): r is MoverRow => r !== null);
    return {
      growth: list.filter((r) => r.trendPct > 0).sort((a, b) => b.trendPct - a.trendPct).slice(0, 5),
      decline: list.filter((r) => r.trendPct < 0).sort((a, b) => a.trendPct - b.trendPct).slice(0, 5),
    };
  }
  const crossProductIds = new Set(monthlyTrendRows.map((m) => m.productId));
  const topMoversScopes: MoverScope[] = [
    {
      code: "ALL",
      label: "Все площадки",
      ...computeTopMovers(crossProductIds, (productId, m) => qtyByProductMonthAll.get(`${productId}|${m.year}-${m.month}`) ?? 0),
    },
    ...marketplaceCodes.map((code) => {
      const productIds = new Set(
        monthlyTrendRows.filter((m) => marketplaceCodeById.get(m.marketplaceId) === code).map((m) => m.productId)
      );
      return {
        code,
        label: marketplaceNameByCode.get(code) ?? code,
        ...computeTopMovers(
          productIds,
          (productId, m) => qtyByProductMarketplaceMonth.get(`${productId}|${code}|${m.year}-${m.month}`) ?? 0
        ),
      };
    }),
  ];

  // Сводка ABC по площадкам — переиспользует buildAbcRows(code), ту же
  // функцию, что и детальная вкладка ABC внутри раздела каждой площадки.
  const abcSummaryRows = marketplaceCodes.map((code) => {
    const abcRowsForCode = buildAbcRows(code);
    return {
      id: code,
      marketplace: marketplaceNameByCode.get(code) ?? code,
      aCount: abcRowsForCode.filter((r) => r.tier === "A").length,
      bCount: abcRowsForCode.filter((r) => r.tier === "B").length,
      cCount: abcRowsForCode.filter((r) => r.tier === "C").length,
      totalRevenue: Math.round(abcRowsForCode.reduce((sum, r) => sum + r.revenueRub, 0) * 100) / 100,
    };
  });

  // Сравнение одного товара между площадками — только там, где он реально
  // продаётся на 2+ площадках сразу (иначе сравнивать не с чем). Цена/ROI/
  // ROAS рядом друг с другом по каждой площадке — не нужно руками сверять
  // три отдельных раздела, чтобы увидеть "на WB ROI выше, чем на Ozon". ROI
  // (не маржа %) — отдача на вложенный в закупку рубль, честнее сравнивает
  // площадки между собой: у одной площадки может быть выше "маржа от цены",
  // но при этом хуже отдача на реально потраченные деньги (себестоимость).
  // Все колонки одной площадки красим её фирменным цветом (тот же
  // MARKETPLACE_CHART_COLORS, что и составные столбики на дашборде выше) —
  // так на глаз сразу видно, где чьи колонки, без чтения каждого заголовка.
  const MARKETPLACE_COL_BG: Record<string, string> = {
    WB: "rgba(147, 51, 234, 0.12)", // фиолетовый
    OZON: "rgba(0, 105, 255, 0.12)", // синий
    YANDEX_MARKET: "rgba(245, 197, 24, 0.12)", // жёлтый
  };
  // ABC/XYZ по каждой площадке — считаем один раз на площадку (не на
  // строку), те же функции, что и в детальной вкладке ABC-анализ каждой
  // площадки (buildAbcRows/xyzTierFor).
  const abcTierByCodeAndProduct = new Map<string, Map<string, "A" | "B" | "C">>();
  for (const code of marketplaceCodes) {
    abcTierByCodeAndProduct.set(code, new Map(buildAbcRows(code).map((r) => [r.id, r.tier])));
  }
  // Короткие подписи для заголовков колонок этой таблицы — с полными
  // названиями площадок ("Яндекс.Маркет: Профит, ₽" и т.п.) текст в узких
  // колонках не помещался и был нечитаем. В description (подсказка при
  // наведении) по-прежнему используем полное название.
  const SHORT_MP_LABEL: Record<string, string> = { WB: "WB", OZON: "Ozon", YANDEX_MARKET: "ЯМ" };
  // Раньше рядом с текстом в заголовке была ещё кнопка "закрепить
  // сортировку" — её убрали (см. SortableTh), поэтому колонкам больше не
  // нужен запас под неё, можно держать их по-настоящему узкими.
  const crossMarketplaceColumns: SortableColumn[] = [
    { key: "photoUrl", label: "", type: "photo", width: 88 },
    { key: "sku", label: "SKU", type: "string", description: "Внутренний SKU товара в CRM", width: 110, noWrap: true },
    { key: "name", label: "Товар", type: "string", description: "Название товара", width: 260 },
    { key: "cogsRub", label: "Себест", type: "number", description: "Себестоимость 1 шт, ₽ — одна на товар, не зависит от площадки (берётся с той площадки, где посчитана последней)", width: 60, noWrap: true },
    ...marketplaceCodes.flatMap((code): SortableColumn[] => {
      const label = marketplaceNameByCode.get(code) ?? code;
      const shortLabel = SHORT_MP_LABEL[code] ?? label;
      // Заголовки без знаков препинания и без ₽/× — только 2 слова, ровно 2
      // строки без переносов внутри строки (единица измерения — в подсказке
      // при наведении, не в самом заголовке).
      const bg = MARKETPLACE_COL_BG[code];
      return [
        { key: `price_${code}`, label: `${shortLabel} Цена`, type: "number", description: `Цена продажи на ${label}, ₽ — из последнего расчёта юнит-экономики, тот же расчёт и период, что и у остальных колонок этой площадки в этой же строке (специально не берём отдельную "среднюю цену" из синка остатков — она считается по другому отчёту за другое окно и может не биться с остальными колонками)`, width: 78, bg, noWrap: true },
        { key: `payout_${code}`, label: `${shortLabel} Выплата`, type: "number", description: `Сколько реально перечисляет ${label} с 1 шт после своих удержаний, ₽ (комиссия, логистика, эквайринг и т.д.) — из последнего расчёта юнит-экономики. Не то же самое, что Профит: тут ещё не вычтены налог и себестоимость`, width: 74, bg, noWrap: true },
        { key: `profit_${code}`, label: `${shortLabel} Профит`, type: "number", description: `Выплата от ${label} минус налог (6% с выплаты, УСН «доходы») минус себестоимость, ₽ — то же самое, что столбец «Профит» на «Юнит-экономике», в разрезе этой площадки`, width: 70, bg, noWrap: true },
        { key: `roas_${code}`, label: `${shortLabel} ROAS`, type: "number", description: `Выручка на 1 ₽ рекламы на ${label}, × — пусто, если рекламу не показывали`, width: 54, bg, noWrap: true },
        { key: `abc_${code}`, label: `${shortLabel} ABC`, type: "string", description: `Группа по вкладу в выручку на ${label} (см. вкладку «ABC-анализ» этой площадки): A — первые 80% накопленной выручки, B — следующие 15%, C — остальные 5%`, width: 52, bg, noWrap: true },
        { key: `xyz_${code}`, label: `${shortLabel} XYZ`, type: "string", description: `Стабильность спроса на ${label} по последним 6 месяцам: X — ровно (≤10%), Y — умеренно (10-25%), Z — скачками (>25%). Пусто — меньше 3 месяцев истории`, width: 52, bg, noWrap: true },
      ];
    }),
    { key: "profitGapRub", label: "Разброс профита", type: "number", description: "Разница между лучшим и худшим профитом с 1 шт этого товара среди площадок, где есть данные, ₽ — чем больше, тем сильнее стоит присмотреться к худшей площадке", width: 74, noWrap: true },
    { key: "bestPlatform", label: "Лучшая площадка", type: "string", description: "Площадка с максимальным профитом с 1 шт для этого товара", width: 70, noWrap: true },
    { key: "priorityBadge", label: "Приоритет", type: "string", description: "Товар класса A/B по вкладу в выручку хотя бы на одной площадке, и (хотя бы одно из двух) — разрыв прибыли между площадками больше себестоимости 1 шт, или на худшей по профиту площадке реклама не окупается (ROAS < 1× или её не было)", width: 150, noWrap: true },
  ];
  function buildCrossMarketplaceRows(): Record<string, unknown>[] {
    const byProduct = new Map<string, typeof perListingRows>();
    for (const r of perListingRows) {
      if (r.noData) continue;
      const list = byProduct.get(r.productId) ?? [];
      list.push(r);
      byProduct.set(r.productId, list);
    }
    const result: Record<string, unknown>[] = [];
    for (const [productId, list] of byProduct) {
      const codesPresent = new Set(list.map((r) => r.marketplaceCode));
      if (codesPresent.size < 2) continue;
      const product = productById.get(productId);
      if (!product) continue;

      const row: Record<string, unknown> = { id: productId, sku: product.sku, name: product.name, photoUrl: product.photoUrl };
      // Себестоимость не зависит от площадки — одна и та же закупочная цена
      // товара, просто посчитана в юнит-экономике каждой площадки отдельно.
      // Берём первое найденное значение (по порядку marketplaceCodes), а не
      // складываем/усредняем — это не сумма, а один и тот же факт.
      row.cogsRub = list.find((x) => x.cogsRub !== null)?.cogsRub ?? null;
      let maxProfit: number | null = null;
      let minProfit: number | null = null;
      let bestCode: string | null = null;
      let worstCode: string | null = null;
      for (const code of marketplaceCodes) {
        const r = list.find((x) => x.marketplaceCode === code);
        // sellPriceRub (юнит-экономика), а не avgPriceRub (синк остатков) —
        // тот же расчёт и период, что и у остальных колонок этой площадки,
        // иначе цифры по разным колонкам не биваются друг с другом (см.
        // разбор бага: avgPriceRub из другого отчёта WB за другое окно мог
        // оказаться даже НИЖЕ выплаты, хотя выплата всегда меньше цены).
        row[`price_${code}`] = r?.sellPriceRub ?? null;
        row[`payout_${code}`] = r?.payoutRub ?? null;
        const profitRub =
          r?.payoutRub !== null && r?.payoutRub !== undefined
            ? Math.round((r.payoutRub * (1 - MARKETPLACE_TAX_RATE) - (r.cogsRub ?? 0)) * 100) / 100
            : null;
        row[`profit_${code}`] = profitRub;
        row[`roas_${code}`] = r?.roasX ?? null;
        row[`abc_${code}`] = abcTierByCodeAndProduct.get(code)?.get(productId) ?? null;
        row[`xyz_${code}`] = xyzTierFor(productId, code);
        if (profitRub !== null) {
          if (maxProfit === null || profitRub > maxProfit) {
            maxProfit = profitRub;
            bestCode = code;
          }
          if (minProfit === null || profitRub < minProfit) {
            minProfit = profitRub;
            worstCode = code;
          }
        }
      }
      row.profitGapRub = maxProfit !== null && minProfit !== null ? Math.round((maxProfit - minProfit) * 100) / 100 : null;
      row.bestPlatform = bestCode ? marketplaceNameByCode.get(bestCode) ?? bestCode : "—";
      // Коды (не только отображаемые названия) — нужны вкладке "Рекомендации"
      // ниже, чтобы достать конкретные price_/payout_/roas_ худшей/лучшей
      // площадки и собрать из них человеческий текст рекомендации.
      row.bestPlatformCode = bestCode;
      row.worstPlatformCode = worstCode;
      row.worstPlatform = worstCode ? marketplaceNameByCode.get(worstCode) ?? worstCode : "—";
      // Приоритетный кандидат — товар реально значимый (A/B по вкладу в
      // выручку ХОТЯ БЫ НА ОДНОЙ площадке — ABC считается от выручки, а
      // "лучшая площадка" здесь — от прибыли, это разные рейтинги, поэтому
      // тир смотрим по всем площадкам сразу, а не только у лидера по
      // прибыли), И (хотя бы одна из двух причин присмотреться):
      //  — разрыв прибыли между площадками больше себестоимости самой
      //    единицы товара (соразмерно крупный, не 5 рублей на дешёвом товаре);
      //  — ИЛИ на худшей по профиту площадке реклама не окупается (ROAS < 1×
      //    или её вообще не было).
      // Раньше требовались ОБА условия сразу — это почти никогда не
      // выполнялось (см. разбор с пользователем), сузили до одной из причин.
      const tiersPresent = marketplaceCodes
        .map((code) => row[`abc_${code}`])
        .filter((t): t is "A" | "B" | "C" => t === "A" || t === "B" || t === "C");
      const bestTierAnyPlatform = tiersPresent.includes("A") ? "A" : tiersPresent.includes("B") ? "B" : tiersPresent[0] ?? null;
      const isSignificant = bestTierAnyPlatform === "A" || bestTierAnyPlatform === "B";
      const worstRoas = worstCode ? row[`roas_${worstCode}`] : null;
      const hasBadRoas = worstRoas === null || (typeof worstRoas === "number" && worstRoas < 1);
      const cogsRubNum = typeof row.cogsRub === "number" ? row.cogsRub : null;
      const hasBigGap =
        row.profitGapRub !== null &&
        typeof row.profitGapRub === "number" &&
        cogsRubNum !== null &&
        cogsRubNum > 0 &&
        row.profitGapRub > cogsRubNum;
      row.priorityCandidate = isSignificant && (hasBigGap || hasBadRoas);
      row.isSignificant = isSignificant;
      row.priorityBadge = !isSignificant
        ? "—"
        : hasBigGap && hasBadRoas
          ? "🔥 Разрыв+реклама"
          : hasBigGap
            ? "🔥 Большой разрыв"
            : hasBadRoas
              ? "🔥 Реклама не окупается"
              : "—";
      result.push(row);
    }
    return result;
  }
  const crossMarketplaceRows = buildCrossMarketplaceRows();

  // "Рекомендации" — сводка по КАЖДОМУ товару (не только тем, что продаются
  // на 2+ площадках), собранная из сигналов со ВСЕХ вкладок: "Пора
  // заказывать"/"Неликвид" (perListingRows), убыточная маржа и ROAS
  // (юнит-экономика), возвраты (те же данные, что и вкладка «Возвраты»),
  // падение продаж (тот же тренд, что в «Динамике»/дашборде), и разрыв
  // прибыли между площадками (та же логика, что в «Сравнении площадок» —
  // только для товаров, которые там участвуют, т.е. продаются на 2+
  // площадках). См. обсуждение с пользователем — раньше эта вкладка
  // показывала только 11-29 товаров с 2+ площадками, теперь — вообще все.
  function fmtRub(value: unknown): string {
    return typeof value === "number" ? Math.round(value).toLocaleString("ru-RU") : "—";
  }
  type Issue = { severity: "critical" | "warning" | "info"; text: string };
  const SEVERITY_RANK: Record<Issue["severity"], number> = { critical: 0, warning: 1, info: 2 };

  function buildCrossMarketplaceIssueText(row: Record<string, unknown>): string {
    const bestCode = row.bestPlatformCode as string | null;
    const worstCode = row.worstPlatformCode as string | null;
    const bestName = (row.bestPlatform as string) ?? "—";
    const worstName = (row.worstPlatform as string) ?? "—";
    const bestProfit = bestCode ? row[`profit_${bestCode}`] : null;
    const worstProfit = worstCode ? row[`profit_${worstCode}`] : null;
    const worstRoas = worstCode ? row[`roas_${worstCode}`] : null;
    const bestPrice = bestCode ? row[`price_${bestCode}`] : null;
    const worstPrice = worstCode ? row[`price_${worstCode}`] : null;
    const badRoas = worstRoas === null || (typeof worstRoas === "number" && worstRoas < 1);

    const parts: string[] = [`Разброс прибыли между площадками ${fmtRub(row.profitGapRub)} ₽.`];
    if (badRoas) {
      parts.push(
        worstRoas === null
          ? `На ${worstName} рекламу, похоже, не показывали вообще — стоит попробовать и посмотреть, окупится ли.`
          : `Реклама на ${worstName} не окупается (ROAS ${worstRoas}×) — приостановите её там или пересмотрите ставки.`
      );
    } else if (typeof bestPrice === "number" && typeof worstPrice === "number" && worstPrice < bestPrice) {
      parts.push(`Цена на ${worstName} (${fmtRub(worstPrice)} ₽) ниже, чем на ${bestName} (${fmtRub(bestPrice)} ₽) — попробуйте поднять цену на ${worstName}.`);
    } else {
      parts.push(`Комиссия/логистика на ${worstName} съедают больше, чем на ${bestName} — стоит свериться с условиями площадки.`);
    }
    parts.push(`Либо перенесите фокус на ${bestName}: там прибыль с 1 шт ${fmtRub(bestProfit)} ₽ против ${fmtRub(worstProfit)} ₽ на ${worstName}.`);
    return parts.join(" ");
  }

  const crossRowByProductId = new Map(crossMarketplaceRows.map((r) => [r.id as string, r]));
  // Тренд по товару в целом (все площадки сразу) — та же карта, что и у
  // "Топ роста/падения" на дашборде, просто здесь на каждый товар отдельно,
  // а не топ-5.
  function productTrendPct(productId: string): number | null {
    const lastM = trendMonths[trendMonths.length - 1];
    const prevM = trendMonths[trendMonths.length - 2];
    const last = qtyByProductMonthAll.get(`${productId}|${lastM.year}-${lastM.month}`) ?? 0;
    const prev = qtyByProductMonthAll.get(`${productId}|${prevM.year}-${prevM.month}`) ?? 0;
    if (prev <= 0) return null;
    return Math.round(((last - prev) / prev) * 10000) / 100;
  }

  function buildProductIssues(productId: string, listings: typeof perListingRows, marketplaceFilter?: string): Issue[] {
    const issues: Issue[] = [];
    const scoped = marketplaceFilter ? listings.filter((r) => r.marketplaceCode === marketplaceFilter) : listings;
    for (const r of scoped) {
      const mp = marketplaceNameByCode.get(r.marketplaceCode) ?? r.marketplaceCode;
      if (r.needsReorder) {
        issues.push({
          severity: "critical",
          text: `Пора заказывать на ${mp}: осталось на ${r.daysOfStockLeft ?? "?"} дн.${
            r.recommendedOrderQty ? ` (рекомендовано ${r.recommendedOrderQty} шт)` : ""
          }`,
        });
      }
      if (r.isDeadStock) {
        issues.push({
          severity: "warning",
          text: `Неликвид на ${mp}${r.isDeadStockEstimated ? " (оценка)" : ""}: остаток ${r.qtyAvailable} шт, продаж почти нет`,
        });
      }
      if (r.netMarginPct !== null && r.netMarginPct < 0) {
        issues.push({ severity: "critical", text: `Убыточная маржа на ${mp}: ${r.netMarginPct}%` });
      }
      if (r.roasX !== null && r.roasX < 1) {
        issues.push({ severity: "warning", text: `Реклама на ${mp} не окупается: ROAS ${r.roasX}×` });
      }
      if (typeof r.orderedQty === "number" && r.orderedQty > 0 && typeof r.returnsQty === "number") {
        const returnPct = Math.round((r.returnsQty / r.orderedQty) * 10000) / 100;
        if (returnPct >= 15) {
          issues.push({ severity: "warning", text: `Высокий % возврата на ${mp}: ${returnPct}%` });
        }
      }
      if (r.turnoverPerYear !== null && r.turnoverPerYear < 2 && r.qtyAvailable > 0) {
        issues.push({
          severity: "info",
          text: `Низкая оборачиваемость на ${mp}: ${r.turnoverPerYear}× в год — деньги заморожены в остатке`,
        });
      }
    }
    if (!marketplaceFilter) {
      const trendPct = productTrendPct(productId);
      if (trendPct !== null && trendPct <= -20) {
        issues.push({ severity: "warning", text: `Продажи падают: ${trendPct}% за последний месяц (все площадки вместе)` });
      }
      const crossRow = crossRowByProductId.get(productId);
      if (crossRow) {
        issues.push({
          severity: crossRow.priorityCandidate ? "critical" : "info",
          text: buildCrossMarketplaceIssueText(crossRow),
        });
      }
    }
    return issues;
  }

  const listingsByProductForRecs = new Map<string, typeof perListingRows>();
  for (const r of perListingRows) {
    const list = listingsByProductForRecs.get(r.productId) ?? [];
    list.push(r);
    listingsByProductForRecs.set(r.productId, list);
  }

  function buildRankedRows<T extends { severity: string }>(
    computeItems: (productId: string, listings: typeof perListingRows) => T[],
    severityRank: Record<string, number>,
    topSeverity: string,
    marketplaceFilter?: string
  ) {
    const entries = marketplaceFilter
      ? [...listingsByProductForRecs.entries()].filter(([, listings]) =>
          listings.some((l) => l.marketplaceCode === marketplaceFilter)
        )
      : [...listingsByProductForRecs.entries()];
    return entries
      .map(([productId, listings]) => {
        const product = productById.get(productId);
        const items = computeItems(productId, listings);
        const worstSeverity = items.reduce((min, i) => Math.min(min, severityRank[i.severity]), 3);
        const criticalCount = items.filter((i) => i.severity === topSeverity).length;
        return {
          id: productId,
          sku: product?.sku ?? listings[0].sku,
          name: product?.name ?? listings[0].name,
          photoUrl: product?.photoUrl ?? listings[0].photoUrl,
          issues: items,
          worstSeverity,
          criticalCount,
          totalCount: items.length,
        };
      })
      .sort(
        (a, b) => a.worstSeverity - b.worstSeverity || b.criticalCount - a.criticalCount || b.totalCount - a.totalCount
      );
  }

  const recommendationRows = buildRankedRows((id, l) => buildProductIssues(id, l), SEVERITY_RANK, "critical");

  // "Топы" — зеркальная логика для сильных позиций: ABC-A (лучшие по
  // выручке), реклама с большим запасом окупаемости, высокая маржа, рост
  // продаж, и возможность выйти с уже доказавшим себя товаром на площадку,
  // где его пока нет. Цель не "закрыть проблему", а подсказать, где стоит
  // усилить то, что и так работает (больше остатка, больше бюджета на
  // рекламу, тест цены, выход на новую площадку).
  type Opportunity = { severity: "top" | "good" | "growth"; text: string };
  const OPPORTUNITY_SEVERITY_RANK: Record<Opportunity["severity"], number> = { top: 0, good: 1, growth: 2 };

  function buildProductOpportunities(productId: string, listings: typeof perListingRows, marketplaceFilter?: string): Opportunity[] {
    const opportunities: Opportunity[] = [];
    const sellingCodes = new Set<string>();
    const scoped = marketplaceFilter ? listings.filter((r) => r.marketplaceCode === marketplaceFilter) : listings;
    for (const r of scoped) {
      const mp = marketplaceNameByCode.get(r.marketplaceCode) ?? r.marketplaceCode;
      const tier = abcTierByCodeAndProduct.get(r.marketplaceCode)?.get(productId);
      if (r.avgDailySalesQty > 0) sellingCodes.add(r.marketplaceCode);
      if (tier === "A") {
        opportunities.push({ severity: "top", text: `Топ по выручке на ${mp} (ABC-A) — следите за остатком, не допускайте обнуления склада` });
      }
      if (r.roasX !== null && r.roasX >= 3) {
        opportunities.push({ severity: "good", text: `Реклама на ${mp} окупается с большим запасом: ROAS ${r.roasX}× — можно попробовать увеличить бюджет` });
      }
      if (r.netMarginPct !== null && r.netMarginPct >= 25) {
        opportunities.push({ severity: "good", text: `Высокая маржа на ${mp}: ${r.netMarginPct}% — есть запас, чтобы протестировать более агрессивную цену или рекламу` });
      }
    }
    if (!marketplaceFilter) {
      const trendPct = productTrendPct(productId);
      if (trendPct !== null && trendPct >= 20) {
        opportunities.push({ severity: "growth", text: `Продажи растут: +${trendPct}% за последний месяц (все площадки вместе) — увеличьте объём следующего заказа, чтобы не упустить рост` });
      }
      const isProvenTop = opportunities.some((o) => o.severity === "top");
      if (isProvenTop && sellingCodes.size > 0) {
        const missingCodes = marketplaceCodes.filter((c) => !sellingCodes.has(c));
        if (missingCodes.length > 0) {
          const missingNames = missingCodes.map((c) => marketplaceNameByCode.get(c) ?? c).join(" и ");
          opportunities.push({ severity: "growth", text: `Хорошо продаётся, но только на ${[...sellingCodes].map((c) => marketplaceNameByCode.get(c) ?? c).join(" и ")} — стоит попробовать вывести на ${missingNames}` });
        }
      }
    }
    return opportunities;
  }

  const opportunityRows = buildRankedRows((id, l) => buildProductOpportunities(id, l), OPPORTUNITY_SEVERITY_RANK, "top");

  function buildMarketplaceRecRows(code: string) {
    return {
      issueRows: buildRankedRows((id, l) => buildProductIssues(id, l, code), SEVERITY_RANK, "critical", code),
      opportunityRows: buildRankedRows(
        (id, l) => buildProductOpportunities(id, l, code),
        OPPORTUNITY_SEVERITY_RANK,
        "top",
        code
      ),
    };
  }

  // "Все товары" внутри рекомендаций площадки — проблемы и топы вперемешку в
  // одной карточке на товар (не в двух разных вкладках), отсортированные по
  // важности внутри самой карточки, чтобы всю картину по одному товару было
  // видно сразу, не переключаясь между "Топы"/"Рекомендации".
  const COMBINED_SEVERITY_RANK: Record<string, number> = {
    critical: 0,
    warning: 1,
    top: 2,
    good: 3,
    growth: 4,
    info: 5,
  };
  function buildCombinedMarketplaceRows(code: string) {
    const entries = [...listingsByProductForRecs.entries()].filter(([, listings]) =>
      listings.some((l) => l.marketplaceCode === code)
    );
    return entries
      .map(([productId, listings]) => {
        const product = productById.get(productId);
        const combined = [...buildProductIssues(productId, listings, code), ...buildProductOpportunities(productId, listings, code)].sort(
          (a, b) => (COMBINED_SEVERITY_RANK[a.severity] ?? 6) - (COMBINED_SEVERITY_RANK[b.severity] ?? 6)
        );
        const worstSeverity = combined.reduce((min, i) => Math.min(min, COMBINED_SEVERITY_RANK[i.severity] ?? 6), 6);
        const criticalCount = combined.filter((i) => i.severity === "critical").length;
        return {
          id: productId,
          sku: product?.sku ?? listings[0].sku,
          name: product?.name ?? listings[0].name,
          photoUrl: product?.photoUrl ?? listings[0].photoUrl,
          issues: combined,
          worstSeverity,
          criticalCount,
          totalCount: combined.length,
        };
      })
      .sort(
        (a, b) => a.worstSeverity - b.worstSeverity || b.criticalCount - a.criticalCount || b.totalCount - a.totalCount
      );
  }

  // Общий набор вложенных вкладок "Все товары / Топы / Рекомендации / Пора
  // заказывать" по одной площадке — используется и внутри вкладки
  // "Рекомендации" (когда проваливаемся в WB/Ozon/ЯМ), и внутри собственного
  // раздела площадки (её под-вкладка "Рекомендации") — те же данные, тот же
  // набор вкладок, чтобы не расходились между собой.
  function buildMarketplaceRecommendationTabs(code: string) {
    const { issueRows, opportunityRows: oppRows } = buildMarketplaceRecRows(code);
    const combinedRows = buildCombinedMarketplaceRows(code);
    const codeReorderCount = reorderAllRows.filter((r) => r.marketplaceCode === code).length;
    const combinedFlaggedCount = combinedRows.filter((r) => r.totalCount > 0).length;
    const oppFlaggedCount = oppRows.filter((r) => r.totalCount > 0).length;
    const issueFlaggedCount = issueRows.filter((r) => r.totalCount > 0).length;
    return [
      {
        key: "combined",
        label: `Все товары (${combinedFlaggedCount})`,
        content: <RecommendationsFilterList issueRows={[]} opportunityRows={[]} combinedRows={combinedRows} fixedMode="combined" />,
      },
      {
        key: "tops",
        label: `Топы (${oppFlaggedCount})`,
        content: <RecommendationsFilterList issueRows={[]} opportunityRows={oppRows} fixedMode="opportunities" />,
      },
      {
        key: "recommendations",
        label: `Рекомендации (${issueFlaggedCount})`,
        content: <RecommendationsFilterList issueRows={issueRows} opportunityRows={[]} fixedMode="issues" />,
      },
      {
        key: "reorder",
        label: `Пора заказывать (${codeReorderCount})`,
        content: buildReorderTabContent(code),
      },
    ];
  }

  // Товары, требующие внимания — по всем площадкам сразу, из уже готовых
  // perListingRows (needsReorder/isDeadStock/netMarginPct/roasX там уже
  // посчитаны для каждой строки товар+площадка).
  const attentionColumns: SortableColumn[] = [
    { key: "photoUrl", label: "", type: "photo" },
    { key: "sku", label: "SKU", type: "string", description: "Внутренний SKU товара в CRM" },
    { key: "name", label: "Товар", type: "string", description: "Название товара с площадки" },
    { key: "marketplace", label: "Площадка", type: "string" },
    { key: "issues", label: "Проблема", type: "string", description: "Может быть сразу несколько причин через запятую" },
    { key: "qtyAvailable", label: "Остаток", type: "number" },
    { key: "avgDailySalesQty", label: "Продаж/день", type: "number" },
    { key: "netMarginPct", label: "Маржа, %", type: "number", description: "Прибыль с 1 шт в % от цены продажи — из последнего расчёта юнит-экономики" },
    { key: "roasX", label: "ROAS, ×", type: "number", description: "Выручка на 1 ₽ рекламы — пусто, если рекламу не показывали" },
  ];
  function computeAttentionRows(sourceRows: typeof perListingRows) {
    return sourceRows
      .map((r) => {
        const issues: string[] = [];
        if (r.needsReorder) issues.push("Пора заказывать");
        if (r.isDeadStock) issues.push(r.isDeadStockEstimated ? "Неликвид (оценка)" : "Неликвид");
        if (r.netMarginPct !== null && r.netMarginPct < 0) issues.push("Убыточная маржа");
        if (r.roasX !== null && r.roasX < 1) issues.push("Реклама не окупается");
        if (issues.length === 0) return null;
        return {
          id: r.id,
          sku: r.sku,
          name: r.name,
          photoUrl: r.photoUrl,
          marketplace: marketplaceNameByCode.get(r.marketplaceCode) ?? r.marketplaceCode,
          issues: issues.join(", "),
          qtyAvailable: r.qtyAvailable,
          avgDailySalesQty: r.avgDailySalesQty,
          netMarginPct: r.netMarginPct,
          roasX: r.roasX,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }
  const attentionScopes: AttentionScope[] = [
    { code: "ALL", label: "Все площадки", rows: computeAttentionRows(perListingRows) },
    ...marketplaceCodes.map((code) => ({
      code,
      label: marketplaceNameByCode.get(code) ?? code,
      rows: computeAttentionRows(perListingRows.filter((r) => r.marketplaceCode === code)),
    })),
  ];

  function buildDashboardSection() {
    return {
      key: "dashboard",
      label: "Дашборд",
      content: (
        <div>
          <h3 style={{ fontSize: 15, marginTop: 0 }}>Выручка и продажи по месяцам</h3>
          <p className="muted">
            Продано, шт — реальные данные по месяцам. Выручка — оценка: штуки
            × цена из последнего расчёта юнит-экономики (не историческая
            цена, юнит-экономика хранит только последний снимок). Переключатель
            — по какой площадке смотреть (или сразу по всем).
          </p>
          <RevenueChartWidget scopes={revenueChartScopes} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 15, marginTop: 28 }}>Профит по месяцам</h3>
              <p className="muted">
                Оценка: реальные штуки по месяцам × текущий профит с 1 шт
                (выплата от площадки минус налог 6% минус себестоимость — тот
                же расчёт, что и столбец «Профит» на «Юнит-экономике»).
                Переключатель — по какой площадке смотреть (или сразу по всем).
              </p>
              <SingleMetricChartWidget scopes={profitChartScopes} color="#16a34a" valueSuffix="₽" />
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: 15, marginTop: 28 }}>Возвраты и отказы, %</h3>
              <p className="muted">
                Снимок за текущий период (не история по месяцам — юнит-экономика
                хранит только последний расчёт). «Возврат» — доля возвратов от
                проданного, по каждой площадке (реальные данные из финотчёта).
                «WB отказ» — доля невыкупленных заказов, доступно только у WB.
              </p>
              <MiniBarChart data={returnsRefusalsChartData} color="#b91c1c" valueSuffix="%" />
            </div>
          </div>

          <h3 style={{ fontSize: 15, marginTop: 28 }}>Топ роста/падения товаров</h3>
          <p className="muted">
            Изменение продаж последнего полного месяца к предыдущему.
            Переключатель — по какой площадке смотреть (или сразу по всем).
          </p>
          <TopMoversWidget scopes={topMoversScopes} />

          <h3 style={{ fontSize: 15, marginTop: 28 }}>Сводка ABC по площадкам</h3>
          <table>
            <thead>
              <tr>
                <th>Площадка</th>
                <th>A, шт</th>
                <th>B, шт</th>
                <th>C, шт</th>
                <th>Выручка за период, ₽</th>
              </tr>
            </thead>
            <tbody>
              {abcSummaryRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.marketplace}</td>
                  <td>{r.aCount}</td>
                  <td>{r.bCount}</td>
                  <td>{r.cCount}</td>
                  <td>{r.totalRevenue.toLocaleString("ru-RU")}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: 15, marginTop: 28 }}>Товары, требующие внимания</h3>
          <p className="muted">
            Пора заказывать, неликвид, убыточная маржа или реклама не
            окупается. Переключатель — по какой площадке смотреть (или сразу
            по всем).
          </p>
          <AttentionWidget scopes={attentionScopes} columns={attentionColumns} />
        </div>
      ),
    };
  }

  // Сравнение площадок по товару — отдельная верхнеуровневая вкладка (была
  // частью Дашборда, но пользователь хотел её отдельно — на Дашборде она
  // оказывалась в самом низу под тремя другими виджетами, до неё было
  // неудобно долистывать).
  function buildCrossMarketplaceSection() {
    return {
      key: "cross-marketplace",
      label: `Сравнение площадок (${crossMarketplaceRows.length})`,
      content: (
        // Full-bleed — у этой таблицы много колонок (цена/выплата/профит/
        // ROAS/ABC/XYZ на каждую площадку), стандартная ширина main
        // (max-width: 1800px) оставляла лишние поля по бокам на широком
        // экране вместо того, чтобы дать колонкам больше места.
        <div style={{ maxWidth: "100vw", marginLeft: "calc(-50vw + 50%)", marginRight: "calc(-50vw + 50%)", padding: "0 24px" }}>
          <p className="muted">
            Только товары, которые продаются на 2+ площадках сразу —
            остальным сравнивать не с чем. «Разброс профита» по умолчанию по
            убыванию — сверху те, где сильнее всего стоит присмотреться к
            худшей площадке.
          </p>
          {crossMarketplaceRows.length === 0 ? (
            <p className="muted">Нет товаров, продающихся сразу на 2+ площадках.</p>
          ) : (
            <PriorityFilterTable
              columns={crossMarketplaceColumns}
              rows={crossMarketplaceRows}
              rowKey="id"
              defaultSortKey="profitGapRub"
              defaultSortDir="desc"
              dense
              photoSize={72}
              denseFontLarge
            />
          )}
        </div>
      ),
    };
  }

  // "Пора заказывать" внутри "Рекомендаций" — та же логика needsReorder, что
  // и на под-вкладке каждой площадки, но сразу по всем трём вместе, чтобы не
  // переключаться между WB/Ozon/Яндекс, чтобы увидеть полную картину закупок.
  const reorderAllRows = perListingRows
    .filter((r) => r.needsReorder)
    .map((r) => ({ ...r, marketplace: marketplaceNameByCode.get(r.marketplaceCode) ?? r.marketplaceCode }))
    .sort((a, b) => (a.daysOfStockLeft ?? Infinity) - (b.daysOfStockLeft ?? Infinity));

  const reorderAllColumns: SortableColumn[] = [
    { key: "photoUrl", label: "", type: "photo", width: 52 },
    { key: "sku", label: "SKU", type: "string", description: "Внутренний SKU товара в CRM", width: 76, noWrap: true },
    { key: "name", label: "Товар", type: "string", description: "Название товара", width: 160 },
    { key: "marketplace", label: "Площадка", type: "string", width: 76, noWrap: true },
    { key: "qtyAvailable", label: "Остаток", type: "number", description: "Текущий остаток на этой площадке", width: 52 },
    { key: "qtyInTransit", label: "Уже едет", type: "number", description: "Сколько уже заказано в Китае и едет, но ещё не оприходовано на склад (не привязано к конкретной площадке — заказ один на все каналы продаж)", width: 52 },
    { key: "avgDailySalesQty", label: "Продаж/день", type: "number", description: `Средняя скорость продаж за последние ${SALES_WINDOW_DAYS_LABEL} дней`, width: 56 },
    { key: "daysOfStockLeft", label: "Дней до конца", type: "number", width: 56 },
    { key: "recommendedOrderQty", label: "Заказать, шт", type: "number", description: `Сколько штук заказать, чтобы хватило на ${TARGET_COVERAGE_DAYS} дней вперёд с учётом остатка, того, что уже едет, и сезонности`, width: 56 },
  ];
  // Внутри одной площадки колонка "Площадка" избыточна — и, в отличие от
  // сводной "все площадки сразу", здесь у каждого товара максимум одна
  // строка (perListingRows — один ряд на пару товар+площадка), поэтому
  // строки для формы заказа можно брать как есть, без объединения по
  // productId.
  const reorderColumnsScoped = reorderAllColumns.filter((c) => c.key !== "marketplace");

  // Для формы создания заказа нужен один ряд на товар (заказ общий на все
  // каналы продаж), а не один на каждую площадку — иначе товар, которому
  // пора заказывать сразу на 2 площадках, задвоился бы в форме (тот же
  // productId дважды) и данные бы затирали друг друга. Складываем остаток и
  // рекомендованное количество по площадкам, где именно этому товару пора
  // заказывать, срочность (дней до конца) берём минимальную — по самой
  // горящей площадке.
  const reorderRowsByProductForOrder = (() => {
    const byProduct = new Map<string, typeof reorderAllRows>();
    for (const r of reorderAllRows) {
      const list = byProduct.get(r.productId) ?? [];
      list.push(r);
      byProduct.set(r.productId, list);
    }
    return [...byProduct.values()].map((list) => {
      const first = list[0];
      const daysLeftValues = list.map((r) => r.daysOfStockLeft).filter((d): d is number => d !== null);
      return {
        productId: first.productId,
        sku: first.sku,
        name: first.name,
        photoUrl: first.photoUrl,
        qtyAvailable: list.reduce((sum, r) => sum + r.qtyAvailable, 0),
        avgDailySalesQty: Math.round(list.reduce((sum, r) => sum + r.avgDailySalesQty, 0) * 100) / 100,
        daysOfStockLeft: daysLeftValues.length > 0 ? Math.min(...daysLeftValues) : null,
        recommendedOrderQty: list.reduce((sum, r) => sum + (r.recommendedOrderQty ?? 0), 0),
        purchasePriceRub: first.purchasePriceRub,
      };
    });
  })();

  // Общее содержимое под-вкладки "Пора заказывать" — используется и в
  // сводном виде (code не задан, все площадки сразу, ряды по productId
  // объединены, чтобы не задваивать форму заказа), и в виде на одну
  // конкретную площадку (code задан — там задвоения productId в принципе
  // не бывает, т.к. в perListingRows один ряд на пару товар+площадка).
  function buildReorderTabContent(code?: string) {
    const rowsForTable = code ? reorderAllRows.filter((r) => r.marketplaceCode === code) : reorderAllRows;
    if (rowsForTable.length === 0) {
      return (
        <p className="muted">
          Нет товаров, которым срочно нужна новая поставка{code ? ` на ${marketplaceNameByCode.get(code) ?? code}` : ""}.
        </p>
      );
    }
    const orderRows = code
      ? rowsForTable.map((r) => ({
          productId: r.productId,
          sku: r.sku,
          name: r.name,
          photoUrl: r.photoUrl,
          qtyAvailable: r.qtyAvailable,
          avgDailySalesQty: r.avgDailySalesQty,
          daysOfStockLeft: r.daysOfStockLeft,
          recommendedOrderQty: r.recommendedOrderQty,
          purchasePriceRub: r.purchasePriceRub,
        }))
      : reorderRowsByProductForOrder;
    return (
      <>
        <p className="muted">
          {code
            ? `Ниже минимального покрытия (${TARGET_COVERAGE_DAYS} дней вперёд, с учётом остатка, того, что уже едет, и сезонности) на ${marketplaceNameByCode.get(code) ?? code}.`
            : `Ниже минимального покрытия (${TARGET_COVERAGE_DAYS} дней вперёд, с учётом остатка, того, что уже едет, и сезонности) — сразу по всем площадкам. Один товар может встретиться несколько раз, если ему пора заказывать на нескольких площадках одновременно.`}
        </p>
        <div className="table-scroll">
          <SortableTable
            columns={code ? reorderColumnsScoped : reorderAllColumns}
            rows={rowsForTable}
            rowKey="id"
            defaultSortKey="daysOfStockLeft"
            defaultSortDir="asc"
            dense
          />
        </div>
        <CreateOrderSection rows={orderRows} />
      </>
    );
  }

  function buildRecommendationsSection() {
    return {
      key: "recommendations",
      label: `Рекомендации (${recommendationRows.length})`,
      content: (
        <div>
          <p className="muted">
            Сводка по каждому товару компании, собранная из всех вкладок
            аналитики. «Проблемы» — «Пора заказывать» и «Неликвид», убыточная
            маржа и реклама, которая не окупается, высокий % возврата, низкая
            оборачиваемость, падение продаж, разрыв прибыли между площадками.
            «Топы» — зеркальная сводка по сильным позициям: ABC-A, реклама с
            большим запасом окупаемости, высокая маржа, рост продаж и
            возможность выйти на площадку, где товара пока нет. В обоих
            случаях сверху — самое существенное. Вкладка каждой площадки
            (WB/Ozon/Яндекс.Маркет) внутри делится на «Все товары» (проблемы
            и топы вперемешку в одной карточке на товар), «Топы»,
            «Рекомендации» и «Пора заказывать» — уже только по её
            собственным данным, без разрыва прибыли между площадками (он
            общий, см. «Все площадки»).
          </p>
          <AnalyticsTabs
            tabs={[
              {
                key: "all",
                label: "Все площадки",
                content: <RecommendationsFilterList issueRows={recommendationRows} opportunityRows={opportunityRows} />,
              },
              {
                key: "reorder",
                label: `Пора заказывать, все (${reorderAllRows.length})`,
                content: buildReorderTabContent(),
              },
              ...marketplaceCodes.map((code) => ({
                key: code,
                label: marketplaceNameByCode.get(code) ?? code,
                content: <AnalyticsTabs tabs={buildMarketplaceRecommendationTabs(code)} />,
              })),
            ]}
          />
        </div>
      ),
    };
  }

  return (
    <div>
      <div className="toolbar">
        <h1>Аналитика</h1>
        <a className="btn" href="/stock-import">
          Импорт остатков
        </a>
      </div>

      <AnalyticsTabs
        tabs={[
          buildDashboardSection(),
          buildRecommendationsSection(),
          buildCrossMarketplaceSection(),
          ...marketplaceCodes.map((code) => buildMarketplaceSection(code)),
        ]}
      />
    </div>
  );
}
