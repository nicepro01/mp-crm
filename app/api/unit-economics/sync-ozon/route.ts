import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { fetchOzonStocks, fetchOzonFinanceTransactions } from "@/lib/ozonApi";

// Ozon ограничивает диапазон одним месяцем ("too long period, only one
// month allowed" — проверено эмпирически, 30 дней от текущего момента уже
// иногда превышают лимит), поэтому окно чуть меньше календарного месяца.
const REPORT_WINDOW_DAYS = 29;

const AD_OPERATION_NAMES = new Set([
  "Оплата за клик",
  "Продвижение с оплатой за заказ",
  "Продвижение бренда",
]);
const STORAGE_OPERATION_NAME = "Услуга размещения товаров на складе";
const ACQUIRING_OPERATION_NAME = "Оплата эквайринга";

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent());
}

async function POSTContent() {
  const marketplace = await prisma.marketplace.findFirst({ where: { code: "OZON" } });
  if (!marketplace) {
    return NextResponse.json(
      { error: "Площадка Ozon не найдена — сначала добавьте её на странице «Площадки»" },
      { status: 400 }
    );
  }

  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - REPORT_WINDOW_DAYS);

  let stocks, transactions;
  try {
    // Остатки тут нужны только ради sku -> артикул продавца (offer_id) —
    // в самих транзакциях artikula нет, только числовой sku Ozon.
    stocks = await fetchOzonStocks();
    transactions = await fetchOzonFinanceTransactions(
      dateFrom.toISOString(),
      dateTo.toISOString()
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Ozon API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }

  const vendorCodeBySku = new Map<number, string>();
  for (const s of stocks) {
    vendorCodeBySku.set(Number(s.ozonSku), s.vendorCode);
  }

  // Одна операция — одна запись за период (продажа/возврат/реклама/хранение/
  // эквайринг/и т.д.), суммируем всё по sku. amount у Ozon уже нетто по этой
  // конкретной операции (выручка минус комиссия минус сопутствующие услуги),
  // поэтому сумма amount по всем операциям товара — надёжная основа для
  // "к оплате поставщику", без риска не так посчитать какую-то из статей.
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

  // Часть операций (в основном "Оплата за клик" без привязки к конкретному
  // товару и общесклад "Кросс-докинг") вообще не содержит sku — Ozon сам не
  // говорит, к какому товару их отнести, поэтому разнести по юнит-экономике
  // конкретных SKU нельзя. Но и молча их терять нельзя — на выборке это
  // реально ~15-20% оборота, а не мелочь. Считаем отдельно, показываем как
  // "расходы без привязки к товару" в сводке синка.
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
    // Одна операция может покрывать несколько единиц (sku повторяется в
    // массиве) — делим её суммы поровну между единицами, чтобы не задвоить.
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
        // "Подразумеваемая" логистика — всё, что операция вычла сверх
        // выручки и комиссии (прямая доставка и сопутствующие услуги этой
        // же продажи). Точнее, чем угадывать по именам services[].
        agg.logisticsRub += Math.abs(perUnitAmount - perUnitAccruals - perUnitCommission);
      } else if (t.type === "returns") {
        agg.quantityReturned += 1;
        agg.reverseLogisticsRub += Math.abs(perUnitAmount);
      } else if (t.operationType === STORAGE_OPERATION_NAME) {
        agg.storageRub += Math.abs(perUnitAmount);
      } else if (AD_OPERATION_NAMES.has(t.operationType)) {
        agg.adsRub += Math.abs(perUnitAmount);
      } else if (t.operationType === ACQUIRING_OPERATION_NAME) {
        agg.acquiringRub += Math.abs(perUnitAmount);
      } else {
        agg.otherFeesRub += Math.abs(perUnitAmount);
      }
    }
  }

  // Расходы без привязки к товару (см. выше) разносим пропорционально доле
  // товара в выручке за тот же период — это ОЦЕНКА, не факт (Ozon сам не
  // говорит, какому товару в реальности принадлежит эта реклама/услуга),
  // но лучше явная оценка, чем расходы, которые нигде не влияют на маржу.
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
      continue; // нет продаж за период — считать среднее на единицу не из чего
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
    // totalAmountRub уже нетто по всем операциям сразу (выручка минус
    // комиссия минус логистика минус хранение минус реклама минус эквайринг
    // минус прочее минус обратная логистика) — то, что реально приходит от
    // Ozon поставщику, без ручного суммирования статей по отдельности.
    const payoutRub = agg.totalAmountRub / agg.quantitySold;
    // Доля этого товара в общей выручке за период × расходы без привязки —
    // условная оценка, подробнее см. комментарий у totalRevenueForAllocation.
    const allocatedOverheadRub =
      totalRevenueForAllocation > 0
        ? (unattributedAmountRub * (agg.revenueRub / totalRevenueForAllocation)) / agg.quantitySold
        : 0;
    const netMarginRub = payoutRub + allocatedOverheadRub - cogsRub;
    const netMarginPct = sellPriceRub > 0 ? (netMarginRub / sellPriceRub) * 100 : 0;
    const mpCommissionPct = agg.revenueRub > 0 ? (agg.commissionRub / agg.revenueRub) * 100 : null;

    await prisma.unitEconomics.upsert({
      where: {
        productId_marketplace_periodMonth: {
          productId: product.id,
          marketplace: "OZON",
          periodMonth,
        },
      },
      create: {
        companyId: getCurrentCompanyId(),
        productId: product.id,
        marketplace: "OZON",
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
        details: {
          quantitySold: agg.quantitySold,
          windowDays: REPORT_WINDOW_DAYS,
          source: "v3/finance/transaction/list",
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
        allocatedOverheadRub,
        returnsQty: agg.quantityReturned,
        payoutRub,
        sellPriceRub,
        netMarginRub,
        netMarginPct,
        details: {
          quantitySold: agg.quantitySold,
          windowDays: REPORT_WINDOW_DAYS,
          source: "v3/finance/transaction/list",
        },
        calculatedAt: new Date(),
      },
    });
    summary.updated++;
  }

  const roundedUnattributed = Math.round(unattributedAmountRub * 100) / 100;
  const unattributedBreakdown = Object.fromEntries(
    [...unattributedByCategory.entries()]
      .sort((a, b) => a[1].amount - b[1].amount) // самые крупные расходы (отриц.) первыми
      .map(([category, { amount, count }]) => [
        category,
        { amount: Math.round(amount * 100) / 100, count },
      ])
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
    unattributedAmountRub: roundedUnattributed,
    unattributedOperations,
    unattributedBreakdown,
  });
}
