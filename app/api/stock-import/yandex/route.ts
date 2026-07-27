import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { parseYandexStockFile } from "@/lib/yandexImport";
import { upsertImportItem } from "@/lib/matching";

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let rows;
  try {
    rows = await parseYandexStockFile(buffer);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось прочитать файл: ${err.message ?? "неизвестная ошибка"}` },
      { status: 400 }
    );
  }

  if (!rows) {
    return NextResponse.json(
      {
        error:
          "Не удалось распознать файл — это не похоже на отчёт «Остатки на складе» из Яндекс.Маркета",
      },
      { status: 400 }
    );
  }

  const marketplace = await prisma.marketplace.findFirst({ where: { code: "YANDEX_MARKET" } });
  if (!marketplace) {
    return NextResponse.json(
      { error: "Площадка Яндекс.Маркет не найдена — сначала добавьте её на странице «Площадки»" },
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
          "Склад Яндекс.Маркет FBO не найден — откройте страницу «Склады», он создастся автоматически",
      },
      { status: 400 }
    );
  }

  const summary = { total: 0, updated: 0, pending: 0, skipped: 0 };
  const pendingCodes: string[] = [];

  for (const row of rows) {
    summary.total++;

    const outcome = await upsertImportItem({
      marketplaceId: marketplace.id,
      mpSku: row.vendorArticle, // общий ключ между отчётами ЯМ — числового ID тут нет
      barcode: null,
      name: row.vendorArticle,
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
          qtyAvailable: row.qty,
          syncSource: "yandex_xlsx_import",
        },
        update: {
          qtyAvailable: row.qty,
          syncSource: "yandex_xlsx_import",
          syncedAt: new Date(),
        },
      });

      // Отчёт "Аналитика продаж" остаток не выгружает — держим его тут же,
      // в ProductStockAnalytics, обновляя остаток и пересчитывая "дней до
      // конца" по уже известной (если есть) скорости продаж. Скорость
      // продаж сюда допишет отдельный импорт "Аналитика продаж".
      const existingAnalytics = await prisma.productStockAnalytics.findUnique({
        where: {
          marketplaceId_mpSku: { marketplaceId: marketplace.id, mpSku: row.vendorArticle },
        },
      });
      const avgDailySalesQty = existingAnalytics ? Number(existingAnalytics.avgDailySalesQty) : 0;
      const daysOfStockLeft =
        avgDailySalesQty > 0 ? Math.round(row.qty / avgDailySalesQty) : null;

      await prisma.productStockAnalytics.upsert({
        where: {
          marketplaceId_mpSku: { marketplaceId: marketplace.id, mpSku: row.vendorArticle },
        },
        create: {
          companyId: getCurrentCompanyId(),
          marketplaceId: marketplace.id,
          productId: matchedProductId,
          mpSku: row.vendorArticle,
          liquidityStatus: null,
          daysOfStockLeft,
          avgDailySalesQty,
          daysWithoutSales: null,
          qtyAvailable: row.qty,
        },
        update: {
          productId: matchedProductId,
          qtyAvailable: row.qty,
          daysOfStockLeft,
          syncedAt: new Date(),
        },
      });

      summary.updated++;
    } else if (outcome.status === "pending") {
      summary.pending++;
      pendingCodes.push(row.vendorArticle);
    } else {
      summary.skipped++;
    }
  }

  return NextResponse.json({ ...summary, pendingCodes });
}
