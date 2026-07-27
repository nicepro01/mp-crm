import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { fetchWbNmIdToVendorCode, fetchWbStocksByWarehouse, fetchWbSales, fetchWbOrders } from "@/lib/wbApi";
import { upsertImportItem } from "@/lib/matching";

// Среднесуточные продажи считаем за то же окно, что и у Ozon (28 дней) —
// единый принцип во всей аналитике.
const SALES_WINDOW_DAYS = 28;

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

  let nmIdMap, stocks, sales, orders;
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - SALES_WINDOW_DAYS);
    // Метод остатков отдаёт только nmId, поэтому карту nmId -> артикул
    // продавца тянем отдельно из Контент API (карточки товаров). Заказы —
    // отдельно от отчёта о продажах: только там есть реальный склад
    // отгрузки (warehouseName), нужный для разбивки остатка/продаж по
    // городам — общий (не по складам) avgDailySalesQty по-прежнему считаем
    // от fetchWbSales(), чтобы не менять уже проверенную логику.
    // Последовательно, не Promise.all — параллельные тяжёлые запросы к WB
    // (несколько категорий сразу) уже приводили к 429/обрыву соединения,
    // см. тот же комментарий в app/api/unit-economics/sync-wb/route.ts.
    nmIdMap = await fetchWbNmIdToVendorCode();
    stocks = await fetchWbStocksByWarehouse();
    sales = await fetchWbSales(dateFrom.toISOString().slice(0, 10));
    orders = await fetchWbOrders(dateFrom.toISOString().slice(0, 10));
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от WB API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }

  type Agg = {
    qtyAvailable: number;
    barcode: string | null;
    name: string | null;
    photoUrl: string | null;
    soldCount: number;
    priceSum: number;
    priceCount: number;
  };
  const byArticle = new Map<string, Agg>();

  function getAgg(article: string): Agg {
    let agg = byArticle.get(article);
    if (!agg) {
      agg = {
        qtyAvailable: 0,
        barcode: null,
        name: null,
        photoUrl: null,
        soldCount: 0,
        priceSum: 0,
        priceCount: 0,
      };
      byArticle.set(article, agg);
    }
    return agg;
  }

  for (const s of stocks) {
    const card = nmIdMap.get(s.nmId);
    if (!card) continue; // карточка не нашлась — не должно случаться, но не валим весь синк
    const agg = getAgg(card.vendorCode.trim());
    agg.qtyAvailable += s.quantity;
    if (!agg.name) agg.name = card.name;
    if (!agg.photoUrl) agg.photoUrl = card.photoUrl;
  }

  // saleID начинается с "S" — реальная продажа, "R" — возврат; возвраты в
  // среднесуточные продажи не считаем, это отдельная метрика. У WB артикул
  // в отчёте о продажах иногда приходит с лишними пробелами по краям —
  // убираем, иначе он не совпадёт с уже сохранённым vendorCode.
  for (const sale of sales) {
    const article = sale.supplierArticle?.trim();
    if (!article || !sale.saleID.startsWith("S")) continue;
    const agg = getAgg(article);
    agg.soldCount += 1;
    if (sale.finishedPrice > 0) {
      agg.priceSum += sale.finishedPrice;
      agg.priceCount += 1;
    }
    if (!agg.barcode && sale.barcode) agg.barcode = sale.barcode;
  }

  // Разбивка по складам — для распределения поставок по городам в
  // Планировщике (см. ProductWarehouseAnalytics). Остаток — из того же
  // fetchWbStocksByWarehouse(), просто не сворачиваем warehouseName;
  // продажи по складу — из fetchWbOrders() (заказы, isCancel=false), т.к. у
  // fetchWbSales() склада отгрузки нет вообще.
  type WarehouseAgg = { qtyAvailable: number; soldCount: number };
  const byArticleWarehouse = new Map<string, WarehouseAgg>();
  function getWarehouseAgg(article: string, warehouseName: string): WarehouseAgg {
    const key = `${article}|${warehouseName}`;
    let agg = byArticleWarehouse.get(key);
    if (!agg) {
      agg = { qtyAvailable: 0, soldCount: 0 };
      byArticleWarehouse.set(key, agg);
    }
    return agg;
  }

  for (const s of stocks) {
    const card = nmIdMap.get(s.nmId);
    if (!card || !s.warehouseName) continue;
    getWarehouseAgg(card.vendorCode.trim(), s.warehouseName).qtyAvailable += s.quantity;
  }
  for (const order of orders) {
    if (order.isCancel || !order.warehouseName) continue;
    const card = nmIdMap.get(order.nmId);
    if (!card) continue;
    getWarehouseAgg(card.vendorCode.trim(), order.warehouseName).soldCount += 1;
  }

  const summary = { total: byArticle.size, updated: 0, pending: 0, skipped: 0 };
  const pendingCodes: string[] = [];
  const matchedProductIdByArticle = new Map<string, string>();

  // Иногда один и тот же товар матчится под ДВУМЯ разными артикулами WB
  // (переиздание карточки, старый артикул нашёлся по штрихкоду) — оба на
  // один Product. ProductStockAnalytics ключуется по mpSku, а не по товару,
  // поэтому без агрегации по productId получились бы задвоенные строки и
  // задвоение в счётчиках на страницах аналитики (та же история, что и с
  // Ozon — см. комментарий в ozon-sync). Копим по productId, пишем одну
  // строку под первым встреченным артикулом.
  type StockAgg = { qtyAvailable: number; soldCount: number; avgPriceRub: number | null; articles: string[] };
  const stockAggByProduct = new Map<string, StockAgg>();

  for (const [article, agg] of byArticle) {
    const outcome = await upsertImportItem({
      marketplaceId: marketplace.id,
      mpSku: article,
      barcode: agg.barcode,
      name: agg.name,
    });

    const matchedProductId =
      outcome.status === "matched" || (outcome.status === "skipped" && outcome.matchedProductId)
        ? (outcome as any).matchedProductId
        : null;

    if (matchedProductId) {
      matchedProductIdByArticle.set(article, matchedProductId);
      const avgPriceRub = agg.priceCount > 0 ? agg.priceSum / agg.priceCount : null;

      // Фото подтягиваем только если у товара его ещё нет — не перезаписываем
      // то, что могли выставить вручную.
      if (agg.photoUrl) {
        await prisma.product.updateMany({
          where: { id: matchedProductId, photoUrl: null },
          data: { photoUrl: agg.photoUrl },
        });
      }

      const productAgg = stockAggByProduct.get(matchedProductId) ?? {
        qtyAvailable: 0,
        soldCount: 0,
        avgPriceRub: null,
        articles: [],
      };
      productAgg.qtyAvailable += agg.qtyAvailable;
      productAgg.soldCount += agg.soldCount;
      if (productAgg.avgPriceRub === null) productAgg.avgPriceRub = avgPriceRub;
      productAgg.articles.push(article);
      stockAggByProduct.set(matchedProductId, productAgg);

      summary.updated++;
    } else if (outcome.status === "pending") {
      summary.pending++;
      pendingCodes.push(article);
    } else {
      summary.skipped++;
    }
  }

  for (const [productId, agg] of stockAggByProduct) {
    const canonicalArticle = agg.articles[0];
    const avgDailySalesQty = agg.soldCount / SALES_WINDOW_DAYS;
    const daysOfStockLeft = avgDailySalesQty > 0 ? Math.round(agg.qtyAvailable / avgDailySalesQty) : null;

    await prisma.productStockAnalytics.upsert({
      where: {
        marketplaceId_mpSku: { marketplaceId: marketplace.id, mpSku: canonicalArticle },
      },
      create: {
        companyId: getCurrentCompanyId(),
        marketplaceId: marketplace.id,
        productId,
        mpSku: canonicalArticle,
        liquidityStatus: null,
        daysOfStockLeft,
        avgDailySalesQty,
        daysWithoutSales: null,
        qtyAvailable: agg.qtyAvailable,
        avgPriceRub: agg.avgPriceRub,
      },
      update: {
        productId,
        daysOfStockLeft,
        avgDailySalesQty,
        qtyAvailable: agg.qtyAvailable,
        avgPriceRub: agg.avgPriceRub,
        syncedAt: new Date(),
      },
    });

    // Старые артикулы того же товара (переизданная карточка и т.п.) —
    // подчищаем, иначе задваивают счётчики на страницах аналитики.
    await prisma.productStockAnalytics.deleteMany({
      where: { marketplaceId: marketplace.id, productId, mpSku: { not: canonicalArticle } },
    });
  }

  // Разбивка по складам — только для товаров, которые уже сопоставлены с
  // карточкой (matchedProductIdByArticle) выше; несопоставленные пропускаем
  // так же, как и в основном синке.
  const touchedWarehousesByArticle = new Map<string, Set<string>>();

  for (const [key, whAgg] of byArticleWarehouse) {
    const sep = key.indexOf("|");
    const article = key.slice(0, sep);
    const warehouseName = key.slice(sep + 1);
    const productId = matchedProductIdByArticle.get(article);
    if (!productId) continue;

    const avgDailySalesQty = whAgg.soldCount / SALES_WINDOW_DAYS;
    await prisma.productWarehouseAnalytics.upsert({
      where: {
        marketplaceId_mpSku_warehouseName: {
          marketplaceId: marketplace.id,
          mpSku: article,
          warehouseName,
        },
      },
      create: {
        companyId: getCurrentCompanyId(),
        marketplaceId: marketplace.id,
        productId,
        mpSku: article,
        warehouseName,
        qtyAvailable: whAgg.qtyAvailable,
        avgDailySalesQty,
      },
      update: {
        productId,
        qtyAvailable: whAgg.qtyAvailable,
        avgDailySalesQty,
        syncedAt: new Date(),
      },
    });

    const set = touchedWarehousesByArticle.get(article) ?? new Set<string>();
    set.add(warehouseName);
    touchedWarehousesByArticle.set(article, set);
  }

  // Склад, на котором в этот раз ничего не осталось (остаток и продажи
  // ушли в 0, WB просто перестал его отдавать), иначе завис бы в базе
  // навсегда со старыми цифрами — подчищаем по каждому обработанному
  // артикулу отдельно, чтобы не задеть товары, которые в этот раз вообще
  // не попали в выборку (напр. сеть легла на часть запроса).
  for (const [article, names] of touchedWarehousesByArticle) {
    await prisma.productWarehouseAnalytics.deleteMany({
      where: {
        marketplaceId: marketplace.id,
        mpSku: article,
        warehouseName: { notIn: [...names] },
      },
    });
  }

  return NextResponse.json({ ...summary, pendingCodes });
}
