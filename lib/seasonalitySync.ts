import { prisma } from "@/lib/prisma";
import { getCurrentCompanyId } from "@/lib/tenantContext";
import { fetchWbSales } from "@/lib/wbApi";
import { fetchOzonMonthlySales } from "@/lib/ozonApi";
import { fetchYandexMarketMonthlySales, fetchYandexGoodsRealizationBothCampaigns } from "@/lib/yandexMarketApi";

function ymKey(year: number, month: number) {
  return `${year}-${month}`;
}

export type SeasonalitySyncSummary = {
  salesFetched: number;
  matched: number;
  unmatched: number;
  monthsUpserted: number;
};

export type SaleEvent = { productId: string; date: string };
export type MonthlyQty = { productId: string; year: number; month: number; qty: number };

// Сколько дней каждого календарного месяца реально попало в окно
// [fromDate, toDate] — общая логика для событийного (WB) и уже
// агрегированного (Ozon) путей ниже.
function daysInPeriodByYearMonth(fromDate: Date, toDate: Date): Map<string, number> {
  const map = new Map<string, number>();
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    const key = ymKey(cursor.getFullYear(), cursor.getMonth() + 1);
    map.set(key, (map.get(key) ?? 0) + 1);
    cursor.setDate(cursor.getDate() + 1);
  }
  return map;
}

async function upsertMonthlyRows(
  marketplaceId: string,
  rows: { productId: string; year: number; month: number; qty: number; daysInPeriod: number }[]
): Promise<number> {
  const upserts = rows
    .filter((r) => r.daysInPeriod > 0)
    .map((r) =>
      prisma.productMonthlySales.upsert({
        where: {
          productId_marketplaceId_year_month: {
            productId: r.productId,
            marketplaceId,
            year: r.year,
            month: r.month,
          },
        },
        create: {
          companyId: getCurrentCompanyId(),
          productId: r.productId,
          marketplaceId,
          year: r.year,
          month: r.month,
          qtySold: r.qty,
          daysInPeriod: r.daysInPeriod,
        },
        update: { qtySold: r.qty, daysInPeriod: r.daysInPeriod, syncedAt: new Date() },
      })
    );
  const results = await Promise.all(upserts);
  return results.length;
}

/**
 * Для площадок, отдающих сырые события продаж (по одной штуке за раз, как
 * WB) — группирует по календарным месяцам и довносит нулями месяцы без
 * продаж внутри фактического окна выгрузки (иначе "мёртвые" месяцы просто
 * выпадут из расчёта и завысят индекс остальных).
 */
async function upsertMonthlySalesFromEvents(
  marketplaceId: string,
  events: SaleEvent[]
): Promise<number> {
  if (events.length === 0) return 0;

  const actualEarliest = events.reduce((min, e) => (e.date < min ? e.date : min), events[0].date);
  const earliestDate = new Date(actualEarliest);
  const today = new Date();
  const daysMap = daysInPeriodByYearMonth(earliestDate, today);

  const qtyByBucket = new Map<string, number>(); // key = productId|year|month
  const productIdsSeen = new Set<string>();
  for (const e of events) {
    productIdsSeen.add(e.productId);
    const d = new Date(e.date);
    const key = `${e.productId}|${d.getFullYear()}|${d.getMonth() + 1}`;
    qtyByBucket.set(key, (qtyByBucket.get(key) ?? 0) + 1);
  }

  for (const productId of productIdsSeen) {
    const cursor = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 1);
    while (cursor <= end) {
      const key = `${productId}|${cursor.getFullYear()}|${cursor.getMonth() + 1}`;
      if (!qtyByBucket.has(key)) qtyByBucket.set(key, 0);
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  const rows = [...qtyByBucket].map(([key, qty]) => {
    const [productId, yearStr, monthStr] = key.split("|");
    const year = Number(yearStr);
    const month = Number(monthStr);
    return { productId, year, month, qty, daysInPeriod: daysMap.get(ymKey(year, month)) ?? 0 };
  });

  return upsertMonthlyRows(marketplaceId, rows);
}

/**
 * Для площадок, уже отдающих готовую помесячную агрегацию по товару (Ozon
 * analytics/data с dimension month+sku) — просто досчитывает daysInPeriod
 * по календарю и сохраняет как есть, без событийной группировки.
 */
async function upsertMonthlySalesFromMonthlyTotals(
  marketplaceId: string,
  dateFrom: Date,
  dateTo: Date,
  rows: MonthlyQty[]
): Promise<number> {
  const daysMap = daysInPeriodByYearMonth(dateFrom, dateTo);
  const withDays = rows.map((r) => ({
    ...r,
    daysInPeriod: daysMap.get(ymKey(r.year, r.month)) ?? 0,
  }));
  return upsertMonthlyRows(marketplaceId, withDays);
}

// Просим по максимуму — WB всё равно фактически отдаёт вглубь только
// ~6-7 месяцев за один запрос, но полная картина по году набирается
// постепенно за счёт повторных синков.
const WB_REQUESTED_HISTORY_DAYS = 400;

/** Тянет историю продаж WB и копит помесячную статистику по товару (см. lib/seasonality.ts). */
export async function syncSeasonalityFromWb(): Promise<SeasonalitySyncSummary> {
  const marketplace = await prisma.marketplace.findFirstOrThrow({ where: { code: "WB" } });
  const products = await prisma.product.findMany({
    where: { vendorCode: { not: null } },
    select: { id: true, vendorCode: true },
  });
  const productIdByVendorCode = new Map(products.map((p) => [p.vendorCode!.trim(), p.id]));

  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - WB_REQUESTED_HISTORY_DAYS);
  const sales = await fetchWbSales(dateFrom.toISOString().slice(0, 10));

  // saleID начинается с "S" — реальная продажа, "R" — возврат; возвраты в
  // сезонность не считаем (тот же принцип, что и в импорте остатков).
  const realSales = sales.filter((s) => s.saleID.startsWith("S"));

  const events: SaleEvent[] = [];
  let matched = 0;
  let unmatched = 0;
  for (const sale of realSales) {
    const article = sale.supplierArticle?.trim();
    const productId = article ? productIdByVendorCode.get(article) : undefined;
    if (!productId) {
      unmatched++;
      continue;
    }
    matched++;
    events.push({ productId, date: sale.date });
  }

  const monthsUpserted = await upsertMonthlySalesFromEvents(marketplace.id, events);
  return { salesFetched: sales.length, matched, unmatched, monthsUpserted };
}

/** Тянет годовую помесячную статистику заказов Ozon (analytics/data) и копит по товару. */
export async function syncSeasonalityFromOzon(): Promise<SeasonalitySyncSummary> {
  const marketplace = await prisma.marketplace.findFirstOrThrow({ where: { code: "OZON" } });
  const products = await prisma.product.findMany({
    select: { id: true, sku: true },
  });
  const productIdBySku = new Map(products.map((p) => [p.sku.trim(), p.id]));

  const monthlySales = await fetchOzonMonthlySales();

  const rows: MonthlyQty[] = [];
  let matched = 0;
  let unmatched = 0;
  for (const m of monthlySales) {
    const productId = productIdBySku.get(m.sku.trim());
    if (!productId) {
      unmatched++;
      continue;
    }
    matched++;
    rows.push({ productId, year: m.year, month: m.month, qty: m.qty });
  }

  const dateTo = new Date();
  dateTo.setDate(dateTo.getDate() - 1);
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateFrom.getDate() - 364);

  const monthsUpserted = await upsertMonthlySalesFromMonthlyTotals(marketplace.id, dateFrom, dateTo, rows);
  return { salesFetched: monthlySales.length, matched, unmatched, monthsUpserted };
}

/**
 * Тянет отчёт «Аналитика продаж» Яндекс.Маркета (доставлено штук по офферу)
 * и копит по товару. Без подписки Маркет не отдаёт данные старше 90 дней —
 * окно короче, чем у WB/Ozon, поэтому полная годовая картина наберётся
 * медленнее, за счёт повторных синков со временем. Метод жёстко ограничен
 * 1 запросом генерации в 10 минут — не дёргать чаще, чем раз в сутки.
 */
export async function syncSeasonalityFromYandexMarket(): Promise<SeasonalitySyncSummary> {
  const marketplace = await prisma.marketplace.findFirstOrThrow({ where: { code: "YANDEX_MARKET" } });
  const products = await prisma.product.findMany({
    where: { vendorCode: { not: null } },
    select: { id: true, vendorCode: true },
  });
  const productIdByVendorCode = new Map(products.map((p) => [p.vendorCode!.trim(), p.id]));

  const monthlySales = await fetchYandexMarketMonthlySales();

  const rows: MonthlyQty[] = [];
  let matched = 0;
  let unmatched = 0;
  for (const m of monthlySales) {
    const productId = productIdByVendorCode.get(m.offerId.trim());
    if (!productId) {
      unmatched++;
      continue;
    }
    matched++;
    rows.push({ productId, year: m.year, month: m.month, qty: m.qty });
  }

  const dateTo = new Date();
  dateTo.setDate(dateTo.getDate() - 1);
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateFrom.getDate() - 89);

  const monthsUpserted = await upsertMonthlySalesFromMonthlyTotals(marketplace.id, dateFrom, dateTo, rows);
  return { salesFetched: monthlySales.length, matched, unmatched, monthsUpserted };
}

const YANDEX_REALIZATION_RATE_LIMIT_MS = 130_000; // 1 запрос генерации в 2 мин на businessId, общий на обе кампании

/**
 * Тянет отчёт «Реализация товаров» (goods-realization) за один конкретный
 * календарный месяц. В отличие от «Аналитики продаж» (см.
 * syncSeasonalityFromYandexMarket выше) этот отчёт НЕ ограничен 90 днями —
 * проверено вживую: за декабрь 2025 при текущей дате конец июля 2026 (почти
 * 8 месяцев назад) отчёт вернул 771 реальную строку. Поэтому годится для
 * бэкфилла истории глубже, чем даёт «Аналитика продаж».
 */
async function syncYandexMonthFromRealization(
  marketplaceId: string,
  productIdByVendorCode: Map<string, string>,
  month: number,
  year: number
): Promise<{ matched: number; unmatched: number; monthsUpserted: number }> {
  const report = await fetchYandexGoodsRealizationBothCampaigns(month, year);

  const qtyBySku = new Map<string, number>();
  for (const row of report.delivered) {
    qtyBySku.set(row.yourSku, (qtyBySku.get(row.yourSku) ?? 0) + row.qty);
  }

  const rows: MonthlyQty[] = [];
  let matched = 0;
  let unmatched = 0;
  for (const [sku, qty] of qtyBySku) {
    const productId = productIdByVendorCode.get(sku.trim());
    if (!productId) {
      unmatched++;
      continue;
    }
    matched++;
    rows.push({ productId, year, month, qty });
  }

  const daysInPeriod = new Date(year, month, 0).getDate(); // число дней в этом календарном месяце
  const monthsUpserted = await upsertMonthlyRows(
    marketplaceId,
    rows.map((r) => ({ ...r, daysInPeriod }))
  );
  return { matched, unmatched, monthsUpserted };
}

/**
 * Бэкфилл более глубокой истории Яндекса, чем даёт 90-дневное окно
 * «Аналитики продаж» (см. syncSeasonalityFromYandexMarket) — идёт по
 * calendar-месяцам назад от последнего полностью закрытого, по одному
 * месяцу за проход. Пишет в ту же таблицу ProductMonthlySales, что и
 * остальные синки сезонности — данные сразу используются везде, где уже
 * применяется computeSeasonalIndex: рекомендация заказа и «Динамика» на
 * Аналитике, Планировщик закупок (app/batches/plan) и экспорт на склад
 * (app/api/batches/[id]/warehouse-export) — не только дашборд.
 *
 * Долго: между запросами generate обязательна пауза (рейт-лимит Яндекса —
 * 1 запрос/2 мин на businessId, общий на FBY+FBS), поэтому monthsBack
 * месяцев займут примерно monthsBack × ~4-4.5 мин. Вызывающий должен
 * запускать это в фоне, не блокируя обычный HTTP-запрос.
 */
export async function syncSeasonalityFromYandexMarketBackfill(monthsBack: number): Promise<SeasonalitySyncSummary> {
  const marketplace = await prisma.marketplace.findFirstOrThrow({ where: { code: "YANDEX_MARKET" } });
  const products = await prisma.product.findMany({
    where: { vendorCode: { not: null } },
    select: { id: true, vendorCode: true },
  });
  const productIdByVendorCode = new Map(products.map((p) => [p.vendorCode!.trim(), p.id]));

  const now = new Date();
  let totalMatched = 0;
  let totalUnmatched = 0;
  let totalMonths = 0;

  for (let i = 1; i <= monthsBack; i++) {
    // i=1 — предыдущий полный календарный месяц, i=2 — тот, что перед ним, и т.д.
    const target = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = target.getFullYear();
    const month = target.getMonth() + 1;

    const { matched, unmatched, monthsUpserted } = await syncYandexMonthFromRealization(
      marketplace.id,
      productIdByVendorCode,
      month,
      year
    );
    totalMatched += matched;
    totalUnmatched += unmatched;
    totalMonths += monthsUpserted;

    if (i < monthsBack) {
      await new Promise((resolve) => setTimeout(resolve, YANDEX_REALIZATION_RATE_LIMIT_MS));
    }
  }

  return {
    salesFetched: totalMatched + totalUnmatched,
    matched: totalMatched,
    unmatched: totalUnmatched,
    monthsUpserted: totalMonths,
  };
}
