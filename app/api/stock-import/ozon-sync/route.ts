import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import {
  fetchOzonStocks,
  fetchOzonStockByWarehouse,
  fetchOzonClusters,
  fetchOzonFinanceTransactions,
} from "@/lib/ozonApi";
import { upsertImportItem } from "@/lib/matching";

// Ozon планирует поставки кластерами (группа складов), а не отдельным
// физическим складом — см. комментарий у fetchOzonClusters. Окно продаж —
// как и везде в аналитике остатков, но Ozon ограничивает диапазон одним
// месяцем, поэтому чуть меньше 30 дней (см. sync-ozon юнит-экономики).
const SALES_WINDOW_DAYS = 28;

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

  const warehouse = await prisma.warehouse.findFirst({
    where: { marketplaceId: marketplace.id, type: "MARKETPLACE_FBO" },
  });
  if (!warehouse) {
    return NextResponse.json(
      {
        error:
          "Склад Ozon FBO не найден — откройте страницу «Склады», он создастся автоматически",
      },
      { status: 400 }
    );
  }

  let rows, warehouseRows, clusters, transactions;
  try {
    const dateTo = new Date();
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - SALES_WINDOW_DAYS);
    [rows, warehouseRows, clusters, transactions] = await Promise.all([
      fetchOzonStocks(),
      fetchOzonStockByWarehouse(),
      fetchOzonClusters(),
      fetchOzonFinanceTransactions(dateFrom.toISOString(), dateTo.toISOString()),
    ]);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Ozon API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }

  // sku -> vendorCode из отчёта остатков — транзакции дают только числовой
  // sku. Считаем здесь же (до основного цикла) суммарные продажи по
  // vendorCode за окно (все кластеры сразу) — нужны для ProductStockAnalytics
  // ниже; разбивка по кластерам отдельно строится позже тем же transactions.
  // revenueByVendorCode — та же логика, что уже проверена в unit-economics
  // sync-ozon (accrualsForSale делим поровну между всеми штуками ОДНОЙ
  // операции — она может продать сразу несколько единиц), нужна для
  // avgPriceRub ниже (раньше эта колонка для Ozon вообще не считалась и
  // всегда была пустой — только avgDailySalesQty, без цены).
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

  // Изредка Ozon отдаёт один и тот же товар (тот же штрихкод) под ДВУМЯ
  // разными ozonSku одновременно (переиздание карточки и т.п.) — оба матчатся
  // на один Product. ProductStockAnalytics ключуется по mpSku, а не по
  // товару, поэтому без агрегации получились бы 2 строки на один товар и
  // задвоение в счётчиках (см. историю бага с "Держатель круглый S20").
  // Копим по productId и пишем одну строку под первым встреченным sku.
  type StockAgg = { qtyAvailable: number; vendorCode: string; skus: string[] };
  const stockAggByProduct = new Map<string, StockAgg>();

  for (const row of rows) {
    const outcome = await upsertImportItem({
      marketplaceId: marketplace.id,
      mpSku: row.ozonSku,
      barcode: null, // Ozon API не отдаёт штрихкод в этом методе
      name: row.vendorCode || null,
    });

    const matchedProductId =
      outcome.status === "matched" || (outcome.status === "skipped" && outcome.matchedProductId)
        ? (outcome as any).matchedProductId
        : null;

    if (matchedProductId) {
      await prisma.stock.upsert({
        where: {
          productId_warehouseId: { productId: matchedProductId, warehouseId: warehouse.id },
        },
        create: {
          companyId: getCurrentCompanyId(),
          productId: matchedProductId,
          warehouseId: warehouse.id,
          qtyAvailable: row.qtyAvailable,
          syncSource: "ozon_api",
        },
        update: {
          qtyAvailable: row.qtyAvailable,
          syncSource: "ozon_api",
          syncedAt: new Date(),
        },
      });

      const agg = stockAggByProduct.get(matchedProductId) ?? {
        qtyAvailable: 0,
        vendorCode: row.vendorCode,
        skus: [],
      };
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

  // ProductStockAnalytics — раньше эту таблицу для Ozon заполнял только
  // ручной загруженный отчёт «Оборачиваемость» (см. ozon-analytics), из-за
  // чего данные молча устаревали между загрузками (до 17 дней на практике) и
  // расходились со страницей «Товары». Теперь синк держит её свежей сам, как
  // уже делают WB и Яндекс. liquidityStatus/daysWithoutSales намеренно не
  // трогаем при update — это категоризация из ручного отчёта, которой у API
  // нет, не затираем её.
  for (const [productId, agg] of stockAggByProduct) {
    const canonicalSku = agg.skus[0];
    const soldCount = soldCountByVendorCode.get(agg.vendorCode) ?? 0;
    const avgDailySalesQty = soldCount / SALES_WINDOW_DAYS;
    const daysOfStockLeft = avgDailySalesQty > 0 ? Math.round(agg.qtyAvailable / avgDailySalesQty) : null;
    // Средняя цена продажи за окно — раньше не считалась вообще (только
    // скорость продаж), из-за чего колонка "Цена, ₽" всегда была пустой на
    // Ozon в Аналитике. Null, если продаж за окно не было (не "цена = 0").
    const avgPriceRub = soldCount > 0 ? (revenueByVendorCode.get(agg.vendorCode) ?? 0) / soldCount : null;

    await prisma.productStockAnalytics.upsert({
      where: {
        marketplaceId_mpSku: { marketplaceId: marketplace.id, mpSku: canonicalSku },
      },
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
      update: {
        productId,
        daysOfStockLeft,
        avgDailySalesQty,
        avgPriceRub,
        qtyAvailable: agg.qtyAvailable,
        syncedAt: new Date(),
      },
    });

    // Старые sku того же товара (переизданная карточка, сменившийся sku и
    // т.п.) — подчищаем, иначе задваивают счётчики на страницах аналитики.
    await prisma.productStockAnalytics.deleteMany({
      where: { marketplaceId: marketplace.id, productId, mpSku: { not: canonicalSku } },
    });
  }

  // Разбивка по КЛАСТЕРАМ (не по отдельному физическому складу) — так Ozon
  // сам группирует склады для планирования поставок, продавец везёт партию
  // в кластер, а дальше Ozon сам распределяет между складами внутри него.
  // Сопоставляем товар напрямую по vendorCode (= item_code из отчёта
  // остатков по складам), а не через upsertImportItem/ozonSku, как основной
  // синк выше — тот же способ, что уже используется для юнит-экономики Ozon.
  const warehouseNameToCluster = new Map(clusters.map((c) => [c.warehouseName, c.clusterName]));
  const warehouseIdToCluster = new Map(clusters.map((c) => [c.warehouseId, c.clusterName]));
  // vendorCodeBySku уже построен выше (перед основным циклом).

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
    if (!clusterName) continue; // склад не нашёлся в справочнике кластеров — редкий край (напр. Минск)
    const productId = await resolveProductId(row.vendorCode);
    if (!productId) continue;
    getClusterAgg(`${row.vendorCode}|${clusterName}`, productId).qtyAvailable += row.qtyAvailable;
  }

  for (const t of transactions) {
    if (t.type !== "orders") continue; // только состоявшиеся продажи, не реклама/хранение/возвраты
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
      where: {
        marketplaceId_mpSku_warehouseName: {
          marketplaceId: marketplace.id,
          mpSku: vendorCode,
          warehouseName: clusterName,
        },
      },
      create: {
        companyId: getCurrentCompanyId(),
        marketplaceId: marketplace.id,
        productId: agg.productId,
        mpSku: vendorCode,
        warehouseName: clusterName,
        qtyAvailable: agg.qtyAvailable,
        avgDailySalesQty,
      },
      update: {
        productId: agg.productId,
        qtyAvailable: agg.qtyAvailable,
        avgDailySalesQty,
        syncedAt: new Date(),
      },
    });

    const set = touchedClustersByVendor.get(vendorCode) ?? new Set<string>();
    set.add(clusterName);
    touchedClustersByVendor.set(vendorCode, set);
  }

  // Кластер, в котором в этот раз ничего не осталось (или который раньше
  // был отдельным физическим складом до перехода на кластеры) — подчищаем
  // по каждому обработанному товару, иначе старые записи зависают в базе
  // навсегда и задваиваются с актуальными при чтении (см. историю бага).
  for (const [vendorCode, names] of touchedClustersByVendor) {
    await prisma.productWarehouseAnalytics.deleteMany({
      where: {
        marketplaceId: marketplace.id,
        mpSku: vendorCode,
        warehouseName: { notIn: [...names] },
      },
    });
  }

  return NextResponse.json({ ...summary, pendingCodes });
}
