import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import {
  fetchYandexGoodsRealizationBothCampaigns,
  fetchYandexServicesReport,
  getYandexCredentials,
  type YandexRealizationRow,
} from "@/lib/yandexMarketApi";

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
const SHEET_CATEGORY: Record<string, "commission" | "logistics" | "acquiring" | "ads" | "storage" | "reverseLogistics"> = {
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

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent());
}

async function POSTContent() {
  const marketplace = await prisma.marketplace.findFirst({ where: { code: "YANDEX_MARKET" } });
  if (!marketplace) {
    return NextResponse.json(
      { error: "Площадка Яндекс.Маркет не найдена — сначала добавьте её на странице «Площадки»" },
      { status: 400 }
    );
  }

  const { year, month, dateFrom, dateTo, periodMonth } = previousMonth();

  let realization, services;
  try {
    // Независимые рейт-лимиты у Яндекса на каждый вид отчёта — можно
    // параллельно, но goods-realization сам по себе уже держит паузу ~130с
    // между FBY и FBS (см. fetchYandexGoodsRealizationBothCampaigns), так
    // что параллельный united-marketplace-services почти не удлиняет синк.
    const { businessId } = await getYandexCredentials();
    [realization, services] = await Promise.all([
      fetchYandexGoodsRealizationBothCampaigns(month, year),
      fetchYandexServicesReport(businessId, dateFrom, dateTo),
    ]);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Yandex Market API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }

  // Заказ -> набор SKU в нём (по всем трём срезам реализации сразу) — чтобы
  // попытаться привязать к товару расходы из листов без колонки "Ваш SKU"
  // (обработка возврата/невыкупа на складе или в ПВЗ), которые Яндекс
  // указывает только через номер заказа. Один заказ обычно = один SKU, но
  // если их несколько — делим стоимость строки поровну (тот же приём, что
  // уже используется для Ozon-транзакций без явной привязки к одной позиции).
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

  // Расходы, которые в принципе нельзя привязать ни к одному товару даже
  // через заказ (подписка, поставка через транзитный склад, лист без "Ваш
  // SKU" и без совпавшего заказа) — как и у Ozon, не теряем молча, а
  // разносим пропорционально выручке товара за период (см. ниже) и
  // сохраняем как отдельный снимок на Marketplace.
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
    const category = SHEET_CATEGORY[row.sheetName] ?? "otherFees";

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

  // Доля товара в выручке за тот же период × расходы без привязки —
  // ОЦЕНКА, не факт (см. тот же приём в sync-ozon).
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
      continue; // нет доставленных продаж за период — считать среднее на единицу не из чего
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

    // К оплате поставщику до вычета себестоимости — выручка минус все
    // удержания площадки (без allocatedOverheadRub, это отдельная оценочная
    // строка, вычитается только из маржи, не из "факта к оплате").
    const payoutRub =
      sellPriceRub - mpCommissionRub - mpLogisticsRub - acquiringRub - adsRub - storageRub - reverseLogisticsRub - otherFeesRub;
    const netMarginRub = payoutRub + allocatedOverheadRub - cogsRub;
    const netMarginPct = sellPriceRub > 0 ? (netMarginRub / sellPriceRub) * 100 : 0;
    const mpCommissionPct = sellPriceRub > 0 ? (mpCommissionRub / sellPriceRub) * 100 : null;

    // Реальный % выкупа — доставлено / (доставлено + невыкуплено), прямой
    // сигнал из отчёта (в отличие от WB, где выкуп считается косвенно через
    // isCancel у заказов) — возвраты (returned) сюда не входят, это уже
    // состоявшийся выкуп, который потом вернули, другая метрика.
    const buyoutDenominator = agg.quantitySold + agg.quantityUnredeemed;
    const buybackPct = buyoutDenominator > 0 ? (agg.quantitySold / buyoutDenominator) * 100 : null;

    await prisma.unitEconomics.upsert({
      where: {
        productId_marketplace_periodMonth: { productId: product.id, marketplace: "YANDEX_MARKET", periodMonth },
      },
      create: {
        companyId: getCurrentCompanyId(),
        productId: product.id,
        marketplace: "YANDEX_MARKET",
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

  return NextResponse.json({
    ...summary,
    notFoundSkus,
    periodYear: year,
    periodMonth: month,
    unattributedAmountRub: roundedUnattributed,
    unattributedOperations,
    unattributedBreakdown,
  });
}
