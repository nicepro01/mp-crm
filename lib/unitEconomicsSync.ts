import type { Marketplace } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentCompanyId } from "./tenantContext";
import { fetchWbNmIdToVendorCode, fetchWbFinanceReport, fetchWbOrders, fetchWbAdSpendByNmId } from "./wbApi";
import { fetchOzonStocks, fetchOzonFinanceTransactions } from "./ozonApi";
import {
  fetchYandexGoodsRealizationBothCampaigns,
  fetchYandexServicesReport,
  getYandexCredentials,
  type YandexRealizationRow,
} from "./yandexMarketApi";

// Извлечено из app/api/unit-economics/sync-{wb,ozon,yandex}/route.ts без
// изменений в самой логике — только так, чтобы lib/dailySync.ts могло
// вызвать это напрямую (без лишнего HTTP-запроса самого на себя), см. план
// "Единая кнопка «Обновить всё»". Площадку (конкретную строку Marketplace,
// т.к. их может быть несколько одного кода — напр. два магазина Ozon)
// резолвит вызывающий код и передаёт сюда готовой — см. lib/dailySync.ts
// (MarketplaceNotConfiguredError бросается там же, до вызова).

// Отчёт о реализации — тяжёлый (несколько МБ за неделю), берём последние
// 30 дней как представительный период для реальной юнит-экономики.
const WB_REPORT_WINDOW_DAYS = 30;
// То же окно, что и у финансового отчёта — расход на рекламу должен
// соответствовать тому же периоду продаж, иначе adsRub/unit будет считаться
// по несовпадающим окнам.
const WB_ADS_WINDOW_DAYS = 30;
// % выкупа считаем ОТДЕЛЬНО от отчёта о реализации — там нет отказов на ПВЗ
// (это не денежная операция, строки просто не существует). Берём реальные
// заказы за то же окно и смотрим, сколько из них не отменено (isCancel).
// Лаг обязателен: у заказа младше ~10 дней исход (выкупят/откажутся) часто
// ещё не наступил, и он ошибочно считается "выкупленным" — проверено
// эмпирически: доля отмен за первые 5 дней ~2-8%, к 10-15 дню стабилизируется
// на ~10-12% и дальше почти не растёт.
const WB_ORDERS_WINDOW_DAYS = 30;
const WB_BUYOUT_LAG_DAYS = 10;

export async function syncWbUnitEconomics(marketplace: Marketplace) {
  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - WB_REPORT_WINDOW_DAYS);
  const ordersDateFrom = new Date();
  ordersDateFrom.setDate(ordersDateFrom.getDate() - WB_ORDERS_WINDOW_DAYS);
  const adsDateFrom = new Date();
  adsDateFrom.setDate(adsDateFrom.getDate() - WB_ADS_WINDOW_DAYS);

  // Последовательно, не Promise.all — тяжёлые запросы бок о бок приводили
  // к обрыву соединения ("fetch failed"), проверено эмпирически. Реклама
  // (fetchWbAdSpendByNmId) сама по себе может занять 1-2 минуты — батчами
  // по 50 кампаний с паузой между батчами из-за строгого рейт-лимита WB.
  const nmIdMap = await fetchWbNmIdToVendorCode(marketplace.id);
  const report = await fetchWbFinanceReport(marketplace.id, dateFrom.toISOString().slice(0, 10), dateTo.toISOString().slice(0, 10));
  const orders = await fetchWbOrders(marketplace.id, ordersDateFrom.toISOString().slice(0, 10));
  const adSpendByNmId = await fetchWbAdSpendByNmId(marketplace.id, adsDateFrom.toISOString().slice(0, 10), dateTo.toISOString().slice(0, 10));

  // % выкупа по nm_id: заказы старше лага (уже успели решиться) минус
  // отменённые/невыкупленные, делённое на все такие заказы.
  const lagCutoff = new Date();
  lagCutoff.setDate(lagCutoff.getDate() - WB_BUYOUT_LAG_DAYS);
  const buyoutByNmId = new Map<number, { total: number; cancelled: number }>();
  for (const o of orders) {
    const orderDate = new Date(o.date);
    if (orderDate > lagCutoff) continue; // ещё не прошло достаточно времени, чтобы исход был известен
    let stat = buyoutByNmId.get(o.nmId);
    if (!stat) {
      stat = { total: 0, cancelled: 0 };
      buyoutByNmId.set(o.nmId, stat);
    }
    stat.total++;
    if (o.isCancel) stat.cancelled++;
  }

  // Одна строка отчёта — одна операция (продажа/логистика/хранение/штраф и
  // т.д.), суммируем всё по nm_id за период. ppvz_for_pay ненулевой только
  // на строках "Продажа"/"Возврат" — это и есть выручка от WB до вычета
  // отдельно тарифицируемых услуг (логистика/хранение/штрафы/удержания).
  type Agg = {
    quantitySold: number;
    quantityReturned: number;
    revenueRub: number;
    payoutRub: number;
    commissionRub: number;
    logisticsRub: number;
    reverseLogisticsRub: number;
    storageRub: number;
    otherFeesRub: number;
    acquiringRub: number;
  };
  const byNmId = new Map<number, Agg>();

  function getAgg(nmId: number): Agg {
    let agg = byNmId.get(nmId);
    if (!agg) {
      agg = {
        quantitySold: 0,
        quantityReturned: 0,
        revenueRub: 0,
        payoutRub: 0,
        commissionRub: 0,
        logisticsRub: 0,
        reverseLogisticsRub: 0,
        storageRub: 0,
        otherFeesRub: 0,
        acquiringRub: 0,
      };
      byNmId.set(nmId, agg);
    }
    return agg;
  }

  for (const row of report) {
    const agg = getAgg(row.nm_id);
    if (row.supplier_oper_name === "Продажа") {
      agg.quantitySold += row.quantity;
      // Реальная цена продажи (после скидки продавца, до комиссии WB) —
      // НЕ retail_amount, это другая, намного меньшая величина.
      agg.revenueRub += row.retail_price_withdisc_rub;
      // Комиссия WB в рублях — только на строках продажи, ppvz_reward тут
      // не подходит (почти всегда 0), берём ppvz_sales_commission (со
      // знаком минус) и переводим в положительное число.
      agg.commissionRub += Math.abs(row.ppvz_sales_commission);
      agg.acquiringRub += row.acquiring_fee;
    }
    if (row.supplier_oper_name === "Возврат") {
      agg.quantityReturned += row.quantity;
    }
    // payoutRub и логистика/хранение/штрафы/удержания — по ВСЕМ строкам,
    // это отдельные операции за период, не только продажи.
    agg.payoutRub += row.ppvz_for_pay;
    agg.logisticsRub += row.delivery_rub;
    agg.reverseLogisticsRub += row.rebill_logistic_cost;
    agg.storageRub += row.storage_fee;
    agg.otherFeesRub += row.penalty + row.deduction + row.acceptance;
  }

  const periodMonth = new Date(Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), 1));
  const summary = { total: 0, updated: 0, noSales: 0, notFound: 0 };
  const notFoundNmIds: number[] = [];

  for (const [nmId, agg] of byNmId) {
    summary.total++;

    if (agg.quantitySold <= 0) {
      summary.noSales++;
      continue; // нет продаж за период — считать среднее на единицу не из чего
    }

    const card = nmIdMap.get(nmId);
    const vendorCode = card?.vendorCode.trim();
    const product = vendorCode ? await prisma.product.findFirst({ where: { vendorCode } }) : null;
    if (!product) {
      summary.notFound++;
      notFoundNmIds.push(nmId);
      continue;
    }

    const cogsRub = product.purchasePriceRub ? Number(product.purchasePriceRub) : 0;
    const sellPriceRub = agg.revenueRub / agg.quantitySold;
    const mpCommissionRub = agg.commissionRub / agg.quantitySold;
    const mpLogisticsRub = agg.logisticsRub / agg.quantitySold;
    const reverseLogisticsRub = agg.reverseLogisticsRub / agg.quantitySold;
    const storageRub = agg.storageRub / agg.quantitySold;
    const otherFeesRub = agg.otherFeesRub / agg.quantitySold;
    const acquiringRub = agg.acquiringRub / agg.quantitySold;
    const adsRub = (adSpendByNmId.get(nmId) ?? 0) / agg.quantitySold;
    const payoutRub =
      agg.payoutRub / agg.quantitySold - mpLogisticsRub - reverseLogisticsRub - storageRub - otherFeesRub - adsRub;
    const netMarginRub = payoutRub - cogsRub;
    const netMarginPct = sellPriceRub > 0 ? (netMarginRub / sellPriceRub) * 100 : 0;
    const mpCommissionPct = agg.revenueRub > 0 ? (agg.commissionRub / agg.revenueRub) * 100 : null;
    const buyoutStat = buyoutByNmId.get(nmId);
    const buybackPct =
      buyoutStat && buyoutStat.total > 0 ? ((buyoutStat.total - buyoutStat.cancelled) / buyoutStat.total) * 100 : null;

    await prisma.unitEconomics.upsert({
      where: { productId_marketplaceId_periodMonth: { productId: product.id, marketplaceId: marketplace.id, periodMonth } },
      create: {
        companyId: getCurrentCompanyId(),
        productId: product.id,
        marketplace: "WB",
        marketplaceId: marketplace.id,
        periodMonth,
        cogsRub,
        inboundLogisticsRub: 0,
        mpCommissionPct,
        mpCommissionRub,
        mpLogisticsRub,
        reverseLogisticsRub,
        storageRub,
        otherFeesRub,
        acquiringRub,
        adsRub,
        taxRub: 0,
        buybackPct,
        returnsQty: agg.quantityReturned,
        payoutRub,
        sellPriceRub,
        netMarginRub,
        netMarginPct,
        details: {
          quantitySold: agg.quantitySold,
          windowDays: WB_REPORT_WINDOW_DAYS,
          source: "reportDetailByPeriod",
          buyoutOrdersTotal: buyoutStat?.total ?? 0,
          buyoutOrdersCancelled: buyoutStat?.cancelled ?? 0,
          buyoutWindowDays: WB_ORDERS_WINDOW_DAYS,
          buyoutLagDays: WB_BUYOUT_LAG_DAYS,
        },
      },
      update: {
        cogsRub,
        mpCommissionPct,
        mpCommissionRub,
        mpLogisticsRub,
        reverseLogisticsRub,
        storageRub,
        otherFeesRub,
        acquiringRub,
        adsRub,
        buybackPct,
        returnsQty: agg.quantityReturned,
        payoutRub,
        sellPriceRub,
        netMarginRub,
        netMarginPct,
        details: {
          quantitySold: agg.quantitySold,
          windowDays: WB_REPORT_WINDOW_DAYS,
          source: "reportDetailByPeriod",
          buyoutOrdersTotal: buyoutStat?.total ?? 0,
          buyoutOrdersCancelled: buyoutStat?.cancelled ?? 0,
          buyoutWindowDays: WB_ORDERS_WINDOW_DAYS,
          buyoutLagDays: WB_BUYOUT_LAG_DAYS,
        },
        calculatedAt: new Date(),
      },
    });
    summary.updated++;
  }

  return { ...summary, notFoundNmIds };
}

// Ozon ограничивает диапазон одним месяцем ("too long period, only one
// month allowed" — проверено эмпирически, 30 дней от текущего момента уже
// иногда превышают лимит), поэтому окно чуть меньше календарного месяца.
const OZON_REPORT_WINDOW_DAYS = 29;

const OZON_AD_OPERATION_NAMES = new Set(["Оплата за клик", "Продвижение с оплатой за заказ", "Продвижение бренда"]);
const OZON_STORAGE_OPERATION_NAME = "Услуга размещения товаров на складе";
const OZON_ACQUIRING_OPERATION_NAME = "Оплата эквайринга";

export async function syncOzonUnitEconomics(marketplace: Marketplace) {
  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - OZON_REPORT_WINDOW_DAYS);

  // Остатки тут нужны только ради sku -> артикул продавца (offer_id) —
  // в самих транзакциях artikula нет, только числовой sku Ozon.
  const stocks = await fetchOzonStocks(marketplace.id);
  const transactions = await fetchOzonFinanceTransactions(marketplace.id, dateFrom.toISOString(), dateTo.toISOString());

  const vendorCodeBySku = new Map<number, string>();
  for (const s of stocks) {
    vendorCodeBySku.set(Number(s.ozonSku), s.vendorCode);
  }

  type Agg = {
    quantitySold: number;
    quantityReturned: number;
    revenueRub: number;
    commissionRub: number;
    logisticsRub: number;
    reverseLogisticsRub: number;
    storageRub: number;
    adsRub: number;
    acquiringRub: number;
    otherFeesRub: number;
    totalAmountRub: number;
  };
  const bySku = new Map<number, Agg>();

  function getAgg(sku: number): Agg {
    let agg = bySku.get(sku);
    if (!agg) {
      agg = {
        quantitySold: 0,
        quantityReturned: 0,
        revenueRub: 0,
        commissionRub: 0,
        logisticsRub: 0,
        reverseLogisticsRub: 0,
        storageRub: 0,
        adsRub: 0,
        acquiringRub: 0,
        otherFeesRub: 0,
        totalAmountRub: 0,
      };
      bySku.set(sku, agg);
    }
    return agg;
  }

  let unattributedAmountRub = 0;
  let unattributedOperations = 0;
  const unattributedByCategory = new Map<string, { amount: number; count: number }>();

  for (const t of transactions) {
    if (t.skus.length === 0) {
      unattributedAmountRub += t.amount;
      unattributedOperations++;
      const cat = unattributedByCategory.get(t.operationType) ?? { amount: 0, count: 0 };
      cat.amount += t.amount;
      cat.count++;
      unattributedByCategory.set(t.operationType, cat);
      continue;
    }
    const nUnits = t.skus.length;
    const perUnitAmount = t.amount / nUnits;
    const perUnitAccruals = t.accrualsForSale / nUnits;
    const perUnitCommission = t.saleCommission / nUnits;

    for (const sku of t.skus) {
      const agg = getAgg(sku);
      agg.totalAmountRub += perUnitAmount;

      if (t.type === "orders") {
        agg.quantitySold += 1;
        agg.revenueRub += perUnitAccruals;
        agg.commissionRub += Math.abs(perUnitCommission);
        agg.logisticsRub += Math.abs(perUnitAmount - perUnitAccruals - perUnitCommission);
      } else if (t.type === "returns") {
        agg.quantityReturned += 1;
        agg.reverseLogisticsRub += Math.abs(perUnitAmount);
      } else if (t.operationType === OZON_STORAGE_OPERATION_NAME) {
        agg.storageRub += Math.abs(perUnitAmount);
      } else if (OZON_AD_OPERATION_NAMES.has(t.operationType)) {
        agg.adsRub += Math.abs(perUnitAmount);
      } else if (t.operationType === OZON_ACQUIRING_OPERATION_NAME) {
        agg.acquiringRub += Math.abs(perUnitAmount);
      } else {
        agg.otherFeesRub += Math.abs(perUnitAmount);
      }
    }
  }

  let totalRevenueForAllocation = 0;
  for (const agg of bySku.values()) {
    if (agg.quantitySold > 0) totalRevenueForAllocation += agg.revenueRub;
  }

  const periodMonth = new Date(Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), 1));
  const summary = { total: 0, updated: 0, noSales: 0, notFound: 0 };
  const notFoundSkus: number[] = [];

  for (const [sku, agg] of bySku) {
    summary.total++;

    if (agg.quantitySold <= 0) {
      summary.noSales++;
      continue;
    }

    const vendorCode = vendorCodeBySku.get(sku);
    const product = vendorCode ? await prisma.product.findFirst({ where: { vendorCode } }) : null;
    if (!product) {
      summary.notFound++;
      notFoundSkus.push(sku);
      continue;
    }

    const cogsRub = product.purchasePriceRub ? Number(product.purchasePriceRub) : 0;
    const sellPriceRub = agg.revenueRub / agg.quantitySold;
    const mpCommissionRub = agg.commissionRub / agg.quantitySold;
    const mpLogisticsRub = agg.logisticsRub / agg.quantitySold;
    const reverseLogisticsRub = agg.reverseLogisticsRub / agg.quantitySold;
    const storageRub = agg.storageRub / agg.quantitySold;
    const adsRub = agg.adsRub / agg.quantitySold;
    const acquiringRub = agg.acquiringRub / agg.quantitySold;
    const otherFeesRub = agg.otherFeesRub / agg.quantitySold;
    const payoutRub = agg.totalAmountRub / agg.quantitySold;
    const allocatedOverheadRub =
      totalRevenueForAllocation > 0
        ? (unattributedAmountRub * (agg.revenueRub / totalRevenueForAllocation)) / agg.quantitySold
        : 0;
    const netMarginRub = payoutRub + allocatedOverheadRub - cogsRub;
    const netMarginPct = sellPriceRub > 0 ? (netMarginRub / sellPriceRub) * 100 : 0;
    const mpCommissionPct = agg.revenueRub > 0 ? (agg.commissionRub / agg.revenueRub) * 100 : null;

    await prisma.unitEconomics.upsert({
      where: { productId_marketplaceId_periodMonth: { productId: product.id, marketplaceId: marketplace.id, periodMonth } },
      create: {
        companyId: getCurrentCompanyId(),
        productId: product.id,
        marketplace: "OZON",
        marketplaceId: marketplace.id,
        periodMonth,
        cogsRub,
        inboundLogisticsRub: 0,
        mpCommissionPct,
        mpCommissionRub,
        mpLogisticsRub,
        reverseLogisticsRub,
        storageRub,
        otherFeesRub,
        acquiringRub,
        adsRub,
        allocatedOverheadRub,
        taxRub: 0,
        returnsQty: agg.quantityReturned,
        payoutRub,
        sellPriceRub,
        netMarginRub,
        netMarginPct,
        details: { quantitySold: agg.quantitySold, windowDays: OZON_REPORT_WINDOW_DAYS, source: "v3/finance/transaction/list" },
      },
      update: {
        cogsRub,
        mpCommissionPct,
        mpCommissionRub,
        mpLogisticsRub,
        reverseLogisticsRub,
        storageRub,
        otherFeesRub,
        acquiringRub,
        adsRub,
        allocatedOverheadRub,
        returnsQty: agg.quantityReturned,
        payoutRub,
        sellPriceRub,
        netMarginRub,
        netMarginPct,
        details: { quantitySold: agg.quantitySold, windowDays: OZON_REPORT_WINDOW_DAYS, source: "v3/finance/transaction/list" },
        calculatedAt: new Date(),
      },
    });
    summary.updated++;
  }

  const roundedUnattributed = Math.round(unattributedAmountRub * 100) / 100;
  const unattributedBreakdown = Object.fromEntries(
    [...unattributedByCategory.entries()]
      .sort((a, b) => a[1].amount - b[1].amount)
      .map(([category, { amount, count }]) => [category, { amount: Math.round(amount * 100) / 100, count }])
  );
  await prisma.marketplace.update({
    where: { id: marketplace.id },
    data: {
      unattributedAmountRub: roundedUnattributed,
      unattributedOperations,
      unattributedSyncedAt: new Date(),
      unattributedBreakdown,
    },
  });

  return {
    ...summary,
    notFoundSkus,
    unattributedAmountRub: roundedUnattributed,
    unattributedOperations,
    unattributedBreakdown,
  };
}

// В отличие от WB/Ozon (скользящее окно N дней от сегодня), у Яндекса оба
// нужных отчёта закрываются строго по календарному месяцу (goods-realization
// принимает month/year, united-marketplace-services — dateFrom/dateTo) — и
// текущий месяц ещё не закрыт документами. Берём последний ПОЛНОСТЬЮ
// завершившийся календарный месяц.
function previousMonth(): { year: number; month: number; dateFrom: string; dateTo: string; periodMonth: Date } {
  const now = new Date();
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastDayPrevMonth = new Date(firstOfThisMonth.getTime() - 86400000);
  const year = lastDayPrevMonth.getUTCFullYear();
  const month = lastDayPrevMonth.getUTCMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    year,
    month,
    dateFrom: `${year}-${pad(month)}-01`,
    dateTo: `${year}-${pad(month)}-${pad(lastDayPrevMonth.getUTCDate())}`,
    periodMonth: new Date(Date.UTC(year, month - 1, 1)),
  };
}

// Листы отчёта "Стоимость услуг маркетплейса" -> в какую статью юнит-
// экономики их суммировать. Всё, что не перечислено (доп. услуги, которых
// сейчас нет у продавца, но могут появиться), уходит в otherFeesRub — чтобы
// не терять деньги молча, даже если лист не был предусмотрен явно.
const YANDEX_SHEET_CATEGORY: Record<
  string,
  "commission" | "logistics" | "acquiring" | "ads" | "storage" | "reverseLogistics"
> = {
  "Размещение товаров и услуг": "commission",
  "Доставка покупателю": "logistics",
  "Доставка (средняя миля)": "logistics",
  "Экспресс-доставка покупателю": "logistics",
  "Приём платежа": "acquiring",
  "Перевод платежа": "acquiring",
  "Буст продаж, оплата за показы": "ads",
  "Буст продаж, оплата за продажи": "ads",
  Полки: "ads",
  "Платное хранение с 01.06.22": "storage",
  "Обработка заказов в СЦ или ПВЗ": "reverseLogistics",
  "Обработка заказов на складе": "reverseLogistics",
  "Хранение невыкупов и возвратов": "reverseLogistics",
};

export async function syncYandexUnitEconomics(marketplace: Marketplace) {
  const { year, month, dateFrom, dateTo, periodMonth } = previousMonth();

  // Независимые рейт-лимиты у Яндекса на каждый вид отчёта — можно
  // параллельно, но goods-realization сам по себе уже держит паузу ~130с
  // между FBY и FBS (см. fetchYandexGoodsRealizationBothCampaigns), так
  // что параллельный united-marketplace-services почти не удлиняет синк.
  const { businessId } = await getYandexCredentials(marketplace.id);
  const [realization, services] = await Promise.all([
    fetchYandexGoodsRealizationBothCampaigns(marketplace.id, month, year),
    fetchYandexServicesReport(marketplace.id, businessId, dateFrom, dateTo),
  ]);

  // Заказ -> набор SKU в нём (по всем трём срезам реализации сразу) — чтобы
  // попытаться привязать к товару расходы из листов без колонки "Ваш SKU"
  // (обработка возврата/невыкупа на складе или в ПВЗ), которые Яндекс
  // указывает только через номер заказа.
  const skusByOrderId = new Map<string, Set<string>>();
  function indexRealizationRows(rows: YandexRealizationRow[]) {
    for (const r of rows) {
      const set = skusByOrderId.get(r.orderId) ?? new Set<string>();
      set.add(r.yourSku);
      skusByOrderId.set(r.orderId, set);
    }
  }
  indexRealizationRows(realization.delivered);
  indexRealizationRows(realization.unredeemed);
  indexRealizationRows(realization.returned);

  type Agg = {
    quantitySold: number;
    quantityUnredeemed: number;
    quantityReturned: number;
    revenueRub: number;
    commissionRub: number;
    logisticsRub: number;
    acquiringRub: number;
    adsRub: number;
    storageRub: number;
    reverseLogisticsRub: number;
    otherFeesRub: number;
  };
  const bySku = new Map<string, Agg>();
  function getAgg(sku: string): Agg {
    let agg = bySku.get(sku);
    if (!agg) {
      agg = {
        quantitySold: 0,
        quantityUnredeemed: 0,
        quantityReturned: 0,
        revenueRub: 0,
        commissionRub: 0,
        logisticsRub: 0,
        acquiringRub: 0,
        adsRub: 0,
        storageRub: 0,
        reverseLogisticsRub: 0,
        otherFeesRub: 0,
      };
      bySku.set(sku, agg);
    }
    return agg;
  }

  for (const r of realization.delivered) {
    const agg = getAgg(r.yourSku);
    agg.quantitySold += r.qty;
    agg.revenueRub += r.revenueRub;
  }
  for (const r of realization.unredeemed) {
    getAgg(r.yourSku).quantityUnredeemed += r.qty;
  }
  for (const r of realization.returned) {
    getAgg(r.yourSku).quantityReturned += r.qty;
  }

  let unattributedAmountRub = 0;
  let unattributedOperations = 0;
  const unattributedBySheet = new Map<string, { amount: number; count: number }>();

  function addUnattributed(sheetName: string, costRub: number) {
    unattributedAmountRub += costRub;
    unattributedOperations++;
    const cat = unattributedBySheet.get(sheetName) ?? { amount: 0, count: 0 };
    cat.amount += costRub;
    cat.count++;
    unattributedBySheet.set(sheetName, cat);
  }

  for (const row of services) {
    const category = YANDEX_SHEET_CATEGORY[row.sheetName] ?? "otherFees";

    let skus: string[] | null = null;
    if (row.yourSku) {
      skus = [row.yourSku];
    } else if (row.orderId) {
      const set = skusByOrderId.get(row.orderId);
      if (set && set.size > 0) skus = [...set];
    }

    if (!skus) {
      addUnattributed(row.sheetName, row.costRub);
      continue;
    }

    const perSkuCost = row.costRub / skus.length;
    for (const sku of skus) {
      const agg = getAgg(sku);
      switch (category) {
        case "commission":
          agg.commissionRub += perSkuCost;
          break;
        case "logistics":
          agg.logisticsRub += perSkuCost;
          break;
        case "acquiring":
          agg.acquiringRub += perSkuCost;
          break;
        case "ads":
          agg.adsRub += perSkuCost;
          break;
        case "storage":
          agg.storageRub += perSkuCost;
          break;
        case "reverseLogistics":
          agg.reverseLogisticsRub += perSkuCost;
          break;
        default:
          agg.otherFeesRub += perSkuCost;
      }
    }
  }

  let totalRevenueForAllocation = 0;
  for (const agg of bySku.values()) {
    if (agg.quantitySold > 0) totalRevenueForAllocation += agg.revenueRub;
  }

  const summary = { total: 0, updated: 0, noSales: 0, notFound: 0 };
  const notFoundSkus: string[] = [];

  for (const [sku, agg] of bySku) {
    summary.total++;

    if (agg.quantitySold <= 0) {
      summary.noSales++;
      continue;
    }

    const product = await prisma.product.findFirst({ where: { vendorCode: sku } });
    if (!product) {
      summary.notFound++;
      notFoundSkus.push(sku);
      continue;
    }

    const cogsRub = product.purchasePriceRub ? Number(product.purchasePriceRub) : 0;
    const sellPriceRub = agg.revenueRub / agg.quantitySold;
    const mpCommissionRub = agg.commissionRub / agg.quantitySold;
    const mpLogisticsRub = agg.logisticsRub / agg.quantitySold;
    const acquiringRub = agg.acquiringRub / agg.quantitySold;
    const adsRub = agg.adsRub / agg.quantitySold;
    const storageRub = agg.storageRub / agg.quantitySold;
    const reverseLogisticsRub = agg.reverseLogisticsRub / agg.quantitySold;
    const otherFeesRub = agg.otherFeesRub / agg.quantitySold;
    const allocatedOverheadRub =
      totalRevenueForAllocation > 0
        ? (unattributedAmountRub * (agg.revenueRub / totalRevenueForAllocation)) / agg.quantitySold
        : 0;

    const payoutRub =
      sellPriceRub - mpCommissionRub - mpLogisticsRub - acquiringRub - adsRub - storageRub - reverseLogisticsRub - otherFeesRub;
    const netMarginRub = payoutRub + allocatedOverheadRub - cogsRub;
    const netMarginPct = sellPriceRub > 0 ? (netMarginRub / sellPriceRub) * 100 : 0;
    const mpCommissionPct = sellPriceRub > 0 ? (mpCommissionRub / sellPriceRub) * 100 : null;

    const buyoutDenominator = agg.quantitySold + agg.quantityUnredeemed;
    const buybackPct = buyoutDenominator > 0 ? (agg.quantitySold / buyoutDenominator) * 100 : null;

    await prisma.unitEconomics.upsert({
      where: { productId_marketplaceId_periodMonth: { productId: product.id, marketplaceId: marketplace.id, periodMonth } },
      create: {
        companyId: getCurrentCompanyId(),
        productId: product.id,
        marketplace: "YANDEX_MARKET",
        marketplaceId: marketplace.id,
        periodMonth,
        cogsRub,
        inboundLogisticsRub: 0,
        mpCommissionPct,
        mpCommissionRub,
        mpLogisticsRub,
        reverseLogisticsRub,
        storageRub,
        acquiringRub,
        adsRub,
        otherFeesRub,
        allocatedOverheadRub,
        taxRub: 0,
        buybackPct,
        returnsQty: agg.quantityReturned,
        payoutRub,
        sellPriceRub,
        netMarginRub,
        netMarginPct,
        details: {
          quantitySold: agg.quantitySold,
          quantityUnredeemed: agg.quantityUnredeemed,
          periodYear: year,
          periodMonthNum: month,
          source: "goods-realization + united-marketplace-services",
        },
      },
      update: {
        cogsRub,
        mpCommissionPct,
        mpCommissionRub,
        mpLogisticsRub,
        reverseLogisticsRub,
        storageRub,
        acquiringRub,
        adsRub,
        otherFeesRub,
        allocatedOverheadRub,
        buybackPct,
        returnsQty: agg.quantityReturned,
        payoutRub,
        sellPriceRub,
        netMarginRub,
        netMarginPct,
        details: {
          quantitySold: agg.quantitySold,
          quantityUnredeemed: agg.quantityUnredeemed,
          periodYear: year,
          periodMonthNum: month,
          source: "goods-realization + united-marketplace-services",
        },
        calculatedAt: new Date(),
      },
    });
    summary.updated++;
  }

  const roundedUnattributed = Math.round(unattributedAmountRub * 100) / 100;
  const unattributedBreakdown = Object.fromEntries(
    [...unattributedBySheet.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([sheetName, { amount, count }]) => [sheetName, { amount: Math.round(amount * 100) / 100, count }])
  );
  await prisma.marketplace.update({
    where: { id: marketplace.id },
    data: {
      unattributedAmountRub: roundedUnattributed,
      unattributedOperations,
      unattributedSyncedAt: new Date(),
      unattributedBreakdown,
    },
  });

  return {
    ...summary,
    notFoundSkus,
    periodYear: year,
    periodMonth: month,
    unattributedAmountRub: roundedUnattributed,
    unattributedOperations,
    unattributedBreakdown,
  };
}
