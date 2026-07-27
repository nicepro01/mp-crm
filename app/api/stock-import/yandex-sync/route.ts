import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import {
  fetchYandexMarketStocks,
  fetchYandexMarketStockByWarehouse,
  fetchYandexMarketSalesByWarehouse,
} from "@/lib/yandexMarketApi";
import { upsertImportItem } from "@/lib/matching";

// То же окно, что и у остальной аналитики остатков — и в пределах лимита
// Yandex на диапазон одного запроса заказов (не больше 30 дней).
const SALES_WINDOW_DAYS = 28;

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

  const [fboWarehouse, fbsWarehouse] = await Promise.all([
    prisma.warehouse.findFirst({ where: { marketplaceId: marketplace.id, type: "MARKETPLACE_FBO" } }),
    prisma.warehouse.findFirst({ where: { marketplaceId: marketplace.id, type: "MARKETPLACE_FBS" } }),
  ]);
  if (!fboWarehouse || !fbsWarehouse) {
    return NextResponse.json(
      {
        error:
          "Склады Яндекс.Маркет FBO/FBS не найдены — откройте страницу «Склады», они создадутся автоматически",
      },
      { status: 400 }
    );
  }

  let rows, warehouseRows, salesRows;
  try {
    [rows, warehouseRows, salesRows] = await Promise.all([
      fetchYandexMarketStocks(),
      fetchYandexMarketStockByWarehouse(),
      fetchYandexMarketSalesByWarehouse(SALES_WINDOW_DAYS),
    ]);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Yandex Market API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }

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
        where: {
          productId_warehouseId: { productId: matchedProductId, warehouseId: fboWarehouse.id },
        },
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
        where: {
          productId_warehouseId: { productId: matchedProductId, warehouseId: fbsWarehouse.id },
        },
        create: {
          companyId: getCurrentCompanyId(),
          productId: matchedProductId,
          warehouseId: fbsWarehouse.id,
          qtyAvailable: row.fbsQty,
          syncSource: "yandex_api",
        },
        update: { qtyAvailable: row.fbsQty, syncSource: "yandex_api", syncedAt: new Date() },
      });

      // ProductStockAnalytics — суммарный остаток по площадке (FBO+FBS),
      // скорость продаж сюда допишет отдельный импорт "Аналитика продаж"
      // (или в будущем — API продаж), сохраняем уже посчитанную как есть.
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

  // Разбивка по складам — для распределения поставок по городам. Продано
  // за период — из fetchYandexMarketSalesByWarehouse (реальные заказы,
  // status=DELIVERED), сводим с остатком по ключу vendorCode|warehouseName.
  const soldByKey = new Map<string, number>();
  for (const s of salesRows) {
    const key = `${s.vendorCode}|${s.warehouseName}`;
    soldByKey.set(key, (soldByKey.get(key) ?? 0) + s.soldQty);
  }

  const warehouseKeys = new Set([
    ...warehouseRows.map((r) => `${r.vendorCode}|${r.warehouseName}`),
    ...soldByKey.keys(),
  ]);
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
      where: {
        marketplaceId_mpSku_warehouseName: {
          marketplaceId: marketplace.id,
          mpSku: vendorCode,
          warehouseName,
        },
      },
      create: {
        companyId: getCurrentCompanyId(),
        marketplaceId: marketplace.id,
        productId,
        mpSku: vendorCode,
        warehouseName,
        qtyAvailable,
        avgDailySalesQty,
      },
      update: {
        productId,
        qtyAvailable,
        avgDailySalesQty,
        syncedAt: new Date(),
      },
    });

    const set = touchedWarehousesByVendor.get(vendorCode) ?? new Set<string>();
    set.add(warehouseName);
    touchedWarehousesByVendor.set(vendorCode, set);
  }

  // Склад, на котором в этот раз ничего не осталось — подчищаем по каждому
  // обработанному товару, иначе старые записи зависают в базе навсегда.
  for (const [vendorCode, names] of touchedWarehousesByVendor) {
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
