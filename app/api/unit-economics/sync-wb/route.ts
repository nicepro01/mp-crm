import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { fetchWbNmIdToVendorCode, fetchWbFinanceReport, fetchWbOrders, fetchWbAdSpendByNmId } from "@/lib/wbApi";

// Отчёт о реализации — тяжёлый (несколько МБ за неделю), берём последние
// 30 дней как представительный период для реальной юнит-экономики.
const REPORT_WINDOW_DAYS = 30;

// То же окно, что и у финансового отчёта — расход на рекламу должен
// соответствовать тому же периоду продаж, иначе adsRub/unit будет считаться
// по несовпадающим окнам.
const ADS_WINDOW_DAYS = 30;

// % выкупа считаем ОТДЕЛЬНО от отчёта о реализации — там нет отказов на ПВЗ
// (это не денежная операция, строки просто не существует). Берём реальные
// заказы за то же окно и смотрим, сколько из них не отменено (isCancel).
// Лаг обязателен: у заказа младше ~10 дней исход (выкупят/откажутся) часто
// ещё не наступил, и он ошибочно считается "выкупленным" — проверено
// эмпирически: доля отмен за первые 5 дней ~2-8%, к 10-15 дню стабилизируется
// на ~10-12% и дальше почти не растёт.
const ORDERS_WINDOW_DAYS = 30;
const BUYOUT_LAG_DAYS = 10;

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent());
}

async function POSTContent() {
  const marketplace = await prisma.marketplace.findFirst({ where: { code: "WB" } });
  if (!marketplace) {
    return NextResponse.json(
      { error: "Площадка WB не найдена — сначала добавьте её на странице «Площадки»" },
      { status: 400 }
    );
  }

  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - REPORT_WINDOW_DAYS);
  const ordersDateFrom = new Date();
  ordersDateFrom.setDate(ordersDateFrom.getDate() - ORDERS_WINDOW_DAYS);
  const adsDateFrom = new Date();
  adsDateFrom.setDate(adsDateFrom.getDate() - ADS_WINDOW_DAYS);

  let nmIdMap, report, orders, adSpendByNmId;
  try {
    // Последовательно, не Promise.all — тяжёлые запросы бок о бок приводили
    // к обрыву соединения ("fetch failed"), проверено эмпирически. Реклама
    // (fetchWbAdSpendByNmId) сама по себе может занять 1-2 минуты — батчами
    // по 50 кампаний с паузой между батчами из-за строгого рейт-лимита WB.
    nmIdMap = await fetchWbNmIdToVendorCode();
    report = await fetchWbFinanceReport(
      dateFrom.toISOString().slice(0, 10),
      dateTo.toISOString().slice(0, 10)
    );
    orders = await fetchWbOrders(ordersDateFrom.toISOString().slice(0, 10));
    adSpendByNmId = await fetchWbAdSpendByNmId(
      adsDateFrom.toISOString().slice(0, 10),
      dateTo.toISOString().slice(0, 10)
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от WB API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }

  // % выкупа по nm_id: заказы старше лага (уже успели решиться) минус
  // отменённые/невыкупленные, делённое на все такие заказы.
  const lagCutoff = new Date();
  lagCutoff.setDate(lagCutoff.getDate() - BUYOUT_LAG_DAYS);
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
    const product = vendorCode
      ? await prisma.product.findFirst({ where: { vendorCode } })
      : null;
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
    // Реклама — отдельный API (Продвижение), не отчёт о реализации, поэтому
    // не в agg. Делим на то же quantitySold, что и остальные расходы (то же
    // 30-дневное окно) — так же, как и они, это реальный расход на единицу.
    const adsRub = (adSpendByNmId.get(nmId) ?? 0) / agg.quantitySold;
    // ppvz_for_pay уже учитывает комиссию и эквайринг этой же строки продажи
    // — их не вычитаем повторно. А логистику/хранение/обратную логистику/
    // рекламу/штрафы/удержания вычитаем явно здесь же, чтобы payoutRub
    // ("Выплата") сразу был ПОЛНОСТЬЮ чистым — за вычетом ВСЕХ расходов
    // площадки (себестоимость — отдельно, это уже не расход площадки, а
    // закупка) — тот же смысл, что и у payoutRub на Ozon/Яндексе, где это
    // уже нетто по всем удержаниям. Раньше здесь считался только частично
    // очищенный payoutRub (только комиссия+эквайринг), а остальное вычиталось
    // ещё раз ниже в netMarginRub — из-за этого "Выплата" по WB нельзя было
    // сравнивать напрямую с "Выплатой" по Ozon/Яндексу.
    const payoutRub =
      agg.payoutRub / agg.quantitySold - mpLogisticsRub - reverseLogisticsRub - storageRub - otherFeesRub - adsRub;
    const netMarginRub = payoutRub - cogsRub;
    const netMarginPct = sellPriceRub > 0 ? (netMarginRub / sellPriceRub) * 100 : 0;
    const mpCommissionPct = agg.revenueRub > 0 ? (agg.commissionRub / agg.revenueRub) * 100 : null;
    const buyoutStat = buyoutByNmId.get(nmId);
    const buybackPct =
      buyoutStat && buyoutStat.total > 0
        ? ((buyoutStat.total - buyoutStat.cancelled) / buyoutStat.total) * 100
        : null;

    await prisma.unitEconomics.upsert({
      where: {
        productId_marketplace_periodMonth: {
          productId: product.id,
          marketplace: "WB",
          periodMonth,
        },
      },
      create: {
        companyId: getCurrentCompanyId(),
        productId: product.id,
        marketplace: "WB",
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
          windowDays: REPORT_WINDOW_DAYS,
          source: "reportDetailByPeriod",
          buyoutOrdersTotal: buyoutStat?.total ?? 0,
          buyoutOrdersCancelled: buyoutStat?.cancelled ?? 0,
          buyoutWindowDays: ORDERS_WINDOW_DAYS,
          buyoutLagDays: BUYOUT_LAG_DAYS,
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
          windowDays: REPORT_WINDOW_DAYS,
          source: "reportDetailByPeriod",
          buyoutOrdersTotal: buyoutStat?.total ?? 0,
          buyoutOrdersCancelled: buyoutStat?.cancelled ?? 0,
          buyoutWindowDays: ORDERS_WINDOW_DAYS,
          buyoutLagDays: BUYOUT_LAG_DAYS,
        },
        calculatedAt: new Date(),
      },
    });
    summary.updated++;
  }

  return NextResponse.json({ ...summary, notFoundNmIds });
}
