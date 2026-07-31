import type { Marketplace } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentCompanyId } from "./tenantContext";
import { MarketplaceNotConfiguredError } from "./syncErrors";
import { fetchWbNmIdToVendorCode, fetchWbStocksByWarehouse, fetchWbSales, fetchWbOrders } from "./wbApi";
import { fetchOzonStocks, fetchOzonStockByWarehouse, fetchOzonClusters, fetchOzonFinanceTransactions } from "./ozonApi";
import {
  fetchYandexMarketStocks,
  fetchYandexMarketStockByWarehouse,
  fetchYandexMarketSalesByWarehouse,
} from "./yandexMarketApi";
import { upsertImportItem } from "./matching";

// Извлечено из app/api/stock-import/{wb,ozon,yandex}-sync/route.ts без
// изменений в логике — см. lib/unitEconomicsSync.ts для объяснения зачем.

// Среднесуточные продажи считаем за одно и то же окно во всей аналитике
// остатков.
const SALES_WINDOW_DAYS = 28;

export async function syncWbStockImport(marketplace: Marketplace) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - SALES_WINDOW_DAYS);
  // Последовательно, не Promise.all — параллельные тяжёлые запросы к WB
  // (несколько категорий сразу) уже приводили к 429/обрыву соединения.
  const nmIdMap = await fetchWbNmIdToVendorCode(marketplace.id);
  const stocks = await fetchWbStocksByWarehouse(marketplace.id);
  const sales = await fetchWbSales(marketplace.id, dateFrom.toISOString().slice(0, 10));
  const orders = await fetchWbOrders(marketplace.id, dateFrom.toISOString().slice(0, 10));

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
      agg = { qtyAvailable: 0, barcode: null, name: null, photoUrl: null, soldCount: 0, priceSum: 0, priceCount: 0 };
      byArticle.set(article, agg);
    }
    return agg;
  }

  for (const s of stocks) {
    const card = nmIdMap.get(s.nmId);
    if (!card) continue;
    const agg = getAgg(card.vendorCode.trim());
    agg.qtyAvailable += s.quantity;
    if (!agg.name) agg.name = card.name;
    if (!agg.photoUrl) agg.photoUrl = card.photoUrl;
  }

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
      where: { marketplaceId_mpSku: { marketplaceId: marketplace.id, mpSku: canonicalArticle } },
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

    await prisma.productStockAnalytics.deleteMany({
      where: { marketplaceId: marketplace.id, productId, mpSku: { not: canonicalArticle } },
    });
  }

  const touchedWarehousesByArticle = new Map<string, Set<string>>();

  for (const [key, whAgg] of byArticleWarehouse) {
    const sep = key.indexOf("|");
    const article = key.slice(0, sep);
    const warehouseName = key.slice(sep + 1);
    const productId = matchedProductIdByArticle.get(article);
    if (!productId) continue;

    const avgDailySalesQty = whAgg.soldCount / SALES_WINDOW_DAYS;
    await prisma.productWarehouseAnalytics.upsert({
      where: { marketplaceId_mpSku_warehouseName: { marketplaceId: marketplace.id, mpSku: article, warehouseName } },
      create: {
        companyId: getCurrentCompanyId(),
        marketplaceId: marketplace.id,
        productId,
        mpSku: article,
        warehouseName,
        qtyAvailable: whAgg.qtyAvailable,
        avgDailySalesQty,
      },
      update: { productId, qtyAvailable: whAgg.qtyAvailable, avgDailySalesQty, syncedAt: new Date() },
    });

    const set = touchedWarehousesByArticle.get(article) ?? new Set<string>();
    set.add(warehouseName);
    touchedWarehousesByArticle.set(article, set);
  }

  for (const [article, names] of touchedWarehousesByArticle) {
    await prisma.productWarehouseAnalytics.deleteMany({
      where: { marketplaceId: marketplace.id, mpSku: article, warehouseName: { notIn: [...names] } },
    });
  }

  return { ...summary, pendingCodes };
}

export async function syncOzonStockImport(marketplace: Marketplace) {
  const warehouse = await prisma.warehouse.findFirst({ where: { marketplaceId: marketplace.id, type: "MARKETPLACE_FBO" } });
  if (!warehouse) {
    throw new MarketplaceNotConfiguredError(`Склад «${marketplace.name}» FBO не найден — откройте страницу «Склады», он создастся автоматически`);
  }

  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - SALES_WINDOW_DAYS);
  const [rows, warehouseRows, clusters, transactions] = await Promise.all([
    fetchOzonStocks(marketplace.id),
    fetchOzonStockByWarehouse(marketplace.id),
    fetchOzonClusters(marketplace.id),
    fetchOzonFinanceTransactions(marketplace.id, dateFrom.toISOString(), dateTo.toISOString()),
  ]);

  const vendorCodeBySku = new Map(rows.map((r) => [r.ozonSku, r.vendorCode]));
  const soldCountByVendorCode = new Map<string, number>();
  const revenueByVendorCode = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "orders") continue;
    const nUnits = t.skus.length || 1;
    const perUnitAccruals = t.accrualsForSale / nUnits;
    for (const sku of t.skus) {
      const vendorCode = vendorCodeBySku.get(String(sku));
      if (!vendorCode) continue;
      soldCountByVendorCode.set(vendorCode, (soldCountByVendorCode.get(vendorCode) ?? 0) + 1);
      revenueByVendorCode.set(vendorCode, (revenueByVendorCode.get(vendorCode) ?? 0) + perUnitAccruals);
    }
  }

  const summary = { total: rows.length, updated: 0, pending: 0, skipped: 0 };
  const pendingCodes: string[] = [];

  type StockAgg = { qtyAvailable: number; vendorCode: string; skus: string[] };
  const stockAggByProduct = new Map<string, StockAgg>();

  for (const row of rows) {
    const outcome = await upsertImportItem({
      marketplaceId: marketplace.id,
      mpSku: row.ozonSku,
      barcode: null,
      name: row.vendorCode || null,
      // mpSku у Ozon — числовой ID площадки, свой для каждого магазина
      // продавца; vendorCode (артикул продавца) — то немногое, что может
      // совпадать между двумя магазинами Ozon одного продавца, поэтому
      // передаём его отдельно для доп. попытки сопоставления по Product.vendorCode.
      vendorCode: row.vendorCode || null,
    });

    const matchedProductId =
      outcome.status === "matched" || (outcome.status === "skipped" && outcome.matchedProductId)
        ? (outcome as any).matchedProductId
        : null;

    if (matchedProductId) {
      await prisma.stock.upsert({
        where: { productId_warehouseId: { productId: matchedProductId, warehouseId: warehouse.id } },
        create: {
          companyId: getCurrentCompanyId(),
          productId: matchedProductId,
          warehouseId: warehouse.id,
          qtyAvailable: row.qtyAvailable,
          syncSource: "ozon_api",
        },
        update: { qtyAvailable: row.qtyAvailable, syncSource: "ozon_api", syncedAt: new Date() },
      });

      const agg = stockAggByProduct.get(matchedProductId) ?? { qtyAvailable: 0, vendorCode: row.vendorCode, skus: [] };
      agg.qtyAvailable += row.qtyAvailable;
      agg.skus.push(row.ozonSku);
      stockAggByProduct.set(matchedProductId, agg);

      summary.updated++;
    } else if (outcome.status === "pending") {
      summary.pending++;
      pendingCodes.push(row.vendorCode ? `${row.ozonSku} (${row.vendorCode})` : row.ozonSku);
    } else {
      summary.skipped++;
    }
  }

  for (const [productId, agg] of stockAggByProduct) {
    const canonicalSku = agg.skus[0];
    const soldCount = soldCountByVendorCode.get(agg.vendorCode) ?? 0;
    const avgDailySalesQty = soldCount / SALES_WINDOW_DAYS;
    const daysOfStockLeft = avgDailySalesQty > 0 ? Math.round(agg.qtyAvailable / avgDailySalesQty) : null;
    const avgPriceRub = soldCount > 0 ? (revenueByVendorCode.get(agg.vendorCode) ?? 0) / soldCount : null;

    await prisma.productStockAnalytics.upsert({
      where: { marketplaceId_mpSku: { marketplaceId: marketplace.id, mpSku: canonicalSku } },
      create: {
        companyId: getCurrentCompanyId(),
        marketplaceId: marketplace.id,
        productId,
        mpSku: canonicalSku,
        liquidityStatus: null,
        daysOfStockLeft,
        avgDailySalesQty,
        avgPriceRub,
        daysWithoutSales: null,
        qtyAvailable: agg.qtyAvailable,
      },
      update: { productId, daysOfStockLeft, avgDailySalesQty, avgPriceRub, qtyAvailable: agg.qtyAvailable, syncedAt: new Date() },
    });

    await prisma.productStockAnalytics.deleteMany({
      where: { marketplaceId: marketplace.id, productId, mpSku: { not: canonicalSku } },
    });
  }

  const warehouseNameToCluster = new Map(clusters.map((c) => [c.warehouseName, c.clusterName]));
  const warehouseIdToCluster = new Map(clusters.map((c) => [c.warehouseId, c.clusterName]));

  type ClusterAgg = { productId: string; qtyAvailable: number; soldCount: number };
  const byVendorCluster = new Map<string, ClusterAgg>();
  const productIdByVendorCode = new Map<string, string | null>();

  async function resolveProductId(vendorCode: string): Promise<string | null> {
    let productId = productIdByVendorCode.get(vendorCode);
    if (productId === undefined) {
      const product = await prisma.product.findFirst({ where: { vendorCode } });
      productId = product?.id ?? null;
      productIdByVendorCode.set(vendorCode, productId);
    }
    return productId;
  }

  function getClusterAgg(key: string, productId: string): ClusterAgg {
    let agg = byVendorCluster.get(key);
    if (!agg) {
      agg = { productId, qtyAvailable: 0, soldCount: 0 };
      byVendorCluster.set(key, agg);
    }
    return agg;
  }

  for (const row of warehouseRows) {
    const clusterName = warehouseNameToCluster.get(row.warehouseName);
    if (!clusterName) continue;
    const productId = await resolveProductId(row.vendorCode);
    if (!productId) continue;
    getClusterAgg(`${row.vendorCode}|${clusterName}`, productId).qtyAvailable += row.qtyAvailable;
  }

  for (const t of transactions) {
    if (t.type !== "orders") continue;
    const clusterName = warehouseIdToCluster.get(t.warehouseId);
    if (!clusterName) continue;
    for (const sku of t.skus) {
      const vendorCode = vendorCodeBySku.get(String(sku));
      if (!vendorCode) continue;
      const productId = await resolveProductId(vendorCode);
      if (!productId) continue;
      getClusterAgg(`${vendorCode}|${clusterName}`, productId).soldCount += 1;
    }
  }

  const touchedClustersByVendor = new Map<string, Set<string>>();

  for (const [key, agg] of byVendorCluster) {
    const sep = key.indexOf("|");
    const vendorCode = key.slice(0, sep);
    const clusterName = key.slice(sep + 1);
    const avgDailySalesQty = agg.soldCount / SALES_WINDOW_DAYS;

    await prisma.productWarehouseAnalytics.upsert({
      where: { marketplaceId_mpSku_warehouseName: { marketplaceId: marketplace.id, mpSku: vendorCode, warehouseName: clusterName } },
      create: {
        companyId: getCurrentCompanyId(),
        marketplaceId: marketplace.id,
        productId: agg.productId,
        mpSku: vendorCode,
        warehouseName: clusterName,
        qtyAvailable: agg.qtyAvailable,
        avgDailySalesQty,
      },
      update: { productId: agg.productId, qtyAvailable: agg.qtyAvailable, avgDailySalesQty, syncedAt: new Date() },
    });

    const set = touchedClustersByVendor.get(vendorCode) ?? new Set<string>();
    set.add(clusterName);
    touchedClustersByVendor.set(vendorCode, set);
  }

  for (const [vendorCode, names] of touchedClustersByVendor) {
    await prisma.productWarehouseAnalytics.deleteMany({
      where: { marketplaceId: marketplace.id, mpSku: vendorCode, warehouseName: { notIn: [...names] } },
    });
  }

  return { ...summary, pendingCodes };
}

export async function syncYandexStockImport(marketplace: Marketplace) {
  const [fboWarehouse, fbsWarehouse] = await Promise.all([
    prisma.warehouse.findFirst({ where: { marketplaceId: marketplace.id, type: "MARKETPLACE_FBO" } }),
    prisma.warehouse.findFirst({ where: { marketplaceId: marketplace.id, type: "MARKETPLACE_FBS" } }),
  ]);
  if (!fboWarehouse || !fbsWarehouse) {
    throw new MarketplaceNotConfiguredError(
      `Склады «${marketplace.name}» FBO/FBS не найдены — откройте страницу «Склады», они создадутся автоматически`
    );
  }

  const [rows, warehouseRows, salesRows] = await Promise.all([
    fetchYandexMarketStocks(marketplace.id),
    fetchYandexMarketStockByWarehouse(marketplace.id),
    fetchYandexMarketSalesByWarehouse(marketplace.id, SALES_WINDOW_DAYS),
  ]);

  const summary = { total: rows.length, updated: 0, pending: 0, skipped: 0 };
  const pendingCodes: string[] = [];
  const matchedProductIdByVendorCode = new Map<string, string>();

  for (const row of rows) {
    const outcome = await upsertImportItem({
      marketplaceId: marketplace.id,
      mpSku: row.vendorCode,
      barcode: null,
      name: row.vendorCode,
    });

    const matchedProductId =
      outcome.status === "matched" || (outcome.status === "skipped" && outcome.matchedProductId)
        ? (outcome as any).matchedProductId
        : null;

    if (matchedProductId) {
      matchedProductIdByVendorCode.set(row.vendorCode, matchedProductId);
      await prisma.stock.upsert({
        where: { productId_warehouseId: { productId: matchedProductId, warehouseId: fboWarehouse.id } },
        create: {
          companyId: getCurrentCompanyId(),
          productId: matchedProductId,
          warehouseId: fboWarehouse.id,
          qtyAvailable: row.fboQty,
          syncSource: "yandex_api",
        },
        update: { qtyAvailable: row.fboQty, syncSource: "yandex_api", syncedAt: new Date() },
      });
      await prisma.stock.upsert({
        where: { productId_warehouseId: { productId: matchedProductId, warehouseId: fbsWarehouse.id } },
        create: {
          companyId: getCurrentCompanyId(),
          productId: matchedProductId,
          warehouseId: fbsWarehouse.id,
          qtyAvailable: row.fbsQty,
          syncSource: "yandex_api",
        },
        update: { qtyAvailable: row.fbsQty, syncSource: "yandex_api", syncedAt: new Date() },
      });

      const totalQty = row.fboQty + row.fbsQty;
      const existingAnalytics = await prisma.productStockAnalytics.findUnique({
        where: { marketplaceId_mpSku: { marketplaceId: marketplace.id, mpSku: row.vendorCode } },
      });
      const avgDailySalesQty = existingAnalytics ? Number(existingAnalytics.avgDailySalesQty) : 0;
      const daysOfStockLeft = avgDailySalesQty > 0 ? Math.round(totalQty / avgDailySalesQty) : null;

      await prisma.productStockAnalytics.upsert({
        where: { marketplaceId_mpSku: { marketplaceId: marketplace.id, mpSku: row.vendorCode } },
        create: {
          companyId: getCurrentCompanyId(),
          marketplaceId: marketplace.id,
          productId: matchedProductId,
          mpSku: row.vendorCode,
          liquidityStatus: null,
          daysOfStockLeft,
          avgDailySalesQty,
          daysWithoutSales: null,
          qtyAvailable: totalQty,
        },
        update: { productId: matchedProductId, qtyAvailable: totalQty, daysOfStockLeft, syncedAt: new Date() },
      });

      summary.updated++;
    } else if (outcome.status === "pending") {
      summary.pending++;
      pendingCodes.push(row.vendorCode);
    } else {
      summary.skipped++;
    }
  }

  const soldByKey = new Map<string, number>();
  for (const s of salesRows) {
    const key = `${s.vendorCode}|${s.warehouseName}`;
    soldByKey.set(key, (soldByKey.get(key) ?? 0) + s.soldQty);
  }

  const warehouseKeys = new Set([...warehouseRows.map((r) => `${r.vendorCode}|${r.warehouseName}`), ...soldByKey.keys()]);
  const qtyByKey = new Map(warehouseRows.map((r) => [`${r.vendorCode}|${r.warehouseName}`, r.qtyAvailable]));

  const touchedWarehousesByVendor = new Map<string, Set<string>>();

  for (const key of warehouseKeys) {
    const sep = key.indexOf("|");
    const vendorCode = key.slice(0, sep);
    const warehouseName = key.slice(sep + 1);
    const productId = matchedProductIdByVendorCode.get(vendorCode);
    if (!productId) continue;

    const qtyAvailable = qtyByKey.get(key) ?? 0;
    const avgDailySalesQty = (soldByKey.get(key) ?? 0) / SALES_WINDOW_DAYS;

    await prisma.productWarehouseAnalytics.upsert({
      where: { marketplaceId_mpSku_warehouseName: { marketplaceId: marketplace.id, mpSku: vendorCode, warehouseName } },
      create: {
        companyId: getCurrentCompanyId(),
        marketplaceId: marketplace.id,
        productId,
        mpSku: vendorCode,
        warehouseName,
        qtyAvailable,
        avgDailySalesQty,
      },
      update: { productId, qtyAvailable, avgDailySalesQty, syncedAt: new Date() },
    });

    const set = touchedWarehousesByVendor.get(vendorCode) ?? new Set<string>();
    set.add(warehouseName);
    touchedWarehousesByVendor.set(vendorCode, set);
  }

  for (const [vendorCode, names] of touchedWarehousesByVendor) {
    await prisma.productWarehouseAnalytics.deleteMany({
      where: { marketplaceId: marketplace.id, mpSku: vendorCode, warehouseName: { notIn: [...names] } },
    });
  }

  return { ...summary, pendingCodes };
}
