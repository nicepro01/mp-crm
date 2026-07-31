import type { Marketplace } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentCompanyId } from "./tenantContext";
import { fetchWbOrders } from "./wbApi";
import { fetchOzonPostings } from "./ozonApi";
import { fetchYandexGoodsRealizationBothCampaigns } from "./yandexMarketApi";

// Те же значения, что и в app/api/unit-economics/sync-wb/route.ts — WB не
// отдаёт сырые заказы старше ~30 дней (жёсткий обрыв API), а заказы младше
// BUYOUT_LAG_DAYS ещё не имеют решённого исхода (выкупят/откажутся).
export const ORDERS_WINDOW_DAYS = 30;
export const BUYOUT_LAG_DAYS = 10;

type DayBucket = {
  ordered: number;
  boughtOut: number;
  cancelled: number;
  orderedSum: number;
  boughtOutSum: number;
  cancelledSum: number;
  provisional: boolean;
};

function emptyBucket(): DayBucket {
  return { ordered: 0, boughtOut: 0, cancelled: 0, orderedSum: 0, boughtOutSum: 0, cancelledSum: 0, provisional: false };
}

async function upsertFunnelRow(params: {
  marketplaceId: string;
  granularity: "DAY" | "MONTH";
  periodStart: Date;
  orderedQty: number;
  boughtOutQty: number;
  cancelledQty: number;
  orderedSumRub: number;
  boughtOutSumRub: number;
  cancelledSumRub: number;
  isProvisional: boolean;
}) {
  // NaN в Decimal-поле уже один раз уронил этот upsert целиком с непонятной
  // ошибкой про "Argument company is missing" вместо жалобы на конкретное
  // поле (реальный инцидент с ценой Ozon, см. lib/ozonApi.ts) — эта же беда
  // может повториться с любым другим неподтверждённым полем цены (WB),
  // поэтому подчищаем NaN здесь в одном месте, а не в каждом источнике отдельно.
  const safe = (n: number) => (Number.isFinite(n) ? n : 0);
  params = {
    ...params,
    orderedSumRub: safe(params.orderedSumRub),
    boughtOutSumRub: safe(params.boughtOutSumRub),
    cancelledSumRub: safe(params.cancelledSumRub),
  };

  await prisma.marketplaceDailyFunnel.upsert({
    where: {
      marketplaceId_granularity_periodStart: {
        marketplaceId: params.marketplaceId,
        granularity: params.granularity,
        periodStart: params.periodStart,
      },
    },
    create: { companyId: getCurrentCompanyId(), ...params },
    update: {
      orderedQty: params.orderedQty,
      boughtOutQty: params.boughtOutQty,
      cancelledQty: params.cancelledQty,
      orderedSumRub: params.orderedSumRub,
      boughtOutSumRub: params.boughtOutSumRub,
      cancelledSumRub: params.cancelledSumRub,
      isProvisional: params.isProvisional,
      syncedAt: new Date(),
    },
  });
}

async function upsertDayBuckets(marketplaceId: string, byDay: Map<string, DayBucket>) {
  let daysUpserted = 0;
  let provisionalDays = 0;
  for (const [day, bucket] of byDay) {
    await upsertFunnelRow({
      marketplaceId,
      granularity: "DAY",
      periodStart: new Date(`${day}T00:00:00.000Z`),
      orderedQty: bucket.ordered,
      boughtOutQty: bucket.boughtOut,
      cancelledQty: bucket.cancelled,
      orderedSumRub: bucket.orderedSum,
      boughtOutSumRub: bucket.boughtOutSum,
      cancelledSumRub: bucket.cancelledSum,
      isProvisional: bucket.provisional,
    });
    daysUpserted++;
    if (bucket.provisional) provisionalDays++;
  }
  return { daysUpserted, provisionalDays };
}

/**
 * WB — реальная история ограничена ~30 днями (см. ORDERS_WINDOW_DAYS), дальше
 * назад API физически не отдаёт. История в marketplace_daily_funnel копится
 * ВПЕРЁД: при каждом вызове перезаписывается только текущее 30-дневное окно,
 * более старые уже сохранённые дни не трогаются — так за недели регулярных
 * синков накапливается больше реальной истории, чем можно получить одним
 * запросом.
 */
export async function syncWbDailyFunnel(marketplace: Marketplace) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - ORDERS_WINDOW_DAYS);
  const orders = await fetchWbOrders(marketplace.id, dateFrom.toISOString().slice(0, 10));

  const lagCutoff = new Date();
  lagCutoff.setDate(lagCutoff.getDate() - BUYOUT_LAG_DAYS);

  const byDay = new Map<string, DayBucket>();
  for (const o of orders) {
    const day = o.date.slice(0, 10);
    let bucket = byDay.get(day);
    if (!bucket) {
      bucket = emptyBucket();
      byDay.set(day, bucket);
    }
    bucket.ordered++;
    bucket.orderedSum += o.priceWithDisc;
    // Внутри лага исход ещё не окончательный — считаем по текущему isCancel,
    // но помечаем isProvisional, чтобы UI не выдавал это за финальный % выкупа.
    if (new Date(o.date) > lagCutoff) bucket.provisional = true;
    if (o.isCancel) {
      bucket.cancelled++;
      bucket.cancelledSum += o.priceWithDisc;
    } else {
      bucket.boughtOut++;
      bucket.boughtOutSum += o.priceWithDisc;
    }
  }

  return upsertDayBuckets(marketplace.id, byDay);
}

/**
 * Ozon — новая функция (fetchOzonPostings), проверена частично на реальном
 * аккаунте (пагинация и корневые поля подтверждены), сумма (priceRub) — нет.
 */
export async function syncOzonDailyFunnel(marketplace: Marketplace, windowDays = 90) {
  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - windowDays);
  const dateFromIso = dateFrom.toISOString();
  const dateToIso = dateTo.toISOString();

  // Последовательно, не Promise.all — параллельные тяжёлые запросы к API
  // площадок в этом проекте уже приводили к обрыву соединения (см. комментарий
  // в app/api/unit-economics/sync-wb/route.ts), придерживаемся того же
  // осторожного паттерна и для нового Ozon-эндпоинта.
  const fbo = await fetchOzonPostings(marketplace.id, dateFromIso, dateToIso, "fbo");
  const fbs = await fetchOzonPostings(marketplace.id, dateFromIso, dateToIso, "fbs");
  const postings = [...fbo, ...fbs];

  const byDay = new Map<string, DayBucket>();
  for (const p of postings) {
    const day = p.createdAt.slice(0, 10);
    let bucket = byDay.get(day);
    if (!bucket) {
      bucket = emptyBucket();
      byDay.set(day, bucket);
    }
    bucket.ordered++;
    bucket.orderedSum += p.priceRub;
    if (p.status === "delivered") {
      bucket.boughtOut++;
      bucket.boughtOutSum += p.priceRub;
    } else if (p.status === "cancelled" || p.status === "returned") {
      bucket.cancelled++;
      bucket.cancelledSum += p.priceRub;
    } else {
      bucket.provisional = true; // ещё в процессе (awaiting_deliver и т.п.)
    }
  }

  return upsertDayBuckets(marketplace.id, byDay);
}

/**
 * Яндекс.Маркет — только помесячная гранулярность (нет дневного отчёта с
 * таким разрезом), переиспользует существующий goods-realization отчёт
 * (тот же, что и в юнит-экономике, включая уже готовый revenueRub на строку).
 * orderedQty здесь = все уже РЕШЁННЫЕ заказы (delivered+unredeemed+returned) —
 * в отличие от WB/Ozon, у Яндекса нет сигнала "заказано, исход не известен".
 */
export async function syncYandexMonthlyFunnel(marketplace: Marketplace, month: number, year: number) {
  const realization = await fetchYandexGoodsRealizationBothCampaigns(marketplace.id, month, year);
  const sumQty = (rows: { qty: number }[]) => rows.reduce((acc, r) => acc + r.qty, 0);
  const sumRevenue = (rows: { revenueRub: number }[]) => rows.reduce((acc, r) => acc + r.revenueRub, 0);

  const boughtOutQty = sumQty(realization.delivered);
  const cancelledQty = sumQty(realization.unredeemed) + sumQty(realization.returned);
  const boughtOutSumRub = sumRevenue(realization.delivered);
  const cancelledSumRub = sumRevenue(realization.unredeemed) + sumRevenue(realization.returned);

  await upsertFunnelRow({
    marketplaceId: marketplace.id,
    granularity: "MONTH",
    periodStart: new Date(Date.UTC(year, month - 1, 1)),
    orderedQty: boughtOutQty + cancelledQty,
    boughtOutQty,
    cancelledQty,
    orderedSumRub: boughtOutSumRub + cancelledSumRub,
    boughtOutSumRub,
    cancelledSumRub,
    isProvisional: false,
  });
}

/**
 * Бэкфилл по образцу syncSeasonalityFromYandexMarketBackfill (см.
 * lib/seasonalitySync.ts) — monthsBack=1 это последний завершённый месяц,
 * каждый следующий на месяц раньше. ~2-2.5 мин на месяц (рейт-лимит внутри
 * fetchYandexGoodsRealizationBothCampaigns) — на Vercel Hobby (лимит 300с на
 * функцию) вызывать с monthsBack=1 за раз, повторяя кнопку для след. месяца.
 */
export async function syncYandexFunnelBackfill(marketplace: Marketplace, monthsBack: number) {
  const now = new Date();
  let monthsSynced = 0;
  for (let i = 1; i <= monthsBack; i++) {
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    await syncYandexMonthlyFunnel(marketplace, target.getUTCMonth() + 1, target.getUTCFullYear());
    monthsSynced++;
  }
  return { monthsSynced };
}
