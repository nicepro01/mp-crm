import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { parseYandexAnalyticsFile } from "@/lib/yandexImport";
import { upsertImportItem } from "@/lib/matching";

// В самом отчёте "Аналитика продаж" период не указан явно (в отличие от
// листа "Остатки", где он есть в заголовке) — берём стандартный месяц,
// как и советуем при выгрузке. Если период отличается, среднесуточные
// продажи будут пропорционально смещены.
const DEFAULT_PERIOD_DAYS = 30;

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
    rows = await parseYandexAnalyticsFile(buffer);
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
          "Не удалось распознать файл — это не похоже на отчёт «Аналитика продаж» из Яндекс.Маркета",
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

  const summary = { total: 0, updated: 0, pending: 0, skipped: 0 };
  const pendingCodes: string[] = [];

  for (const row of rows) {
    summary.total++;

    const outcome = await upsertImportItem({
      marketplaceId: marketplace.id,
      mpSku: row.vendorArticle,
      barcode: null,
      name: row.name || row.vendorArticle,
    });

    const matchedProductId =
      outcome.status === "matched" || (outcome.status === "skipped" && outcome.matchedProductId)
        ? (outcome as any).matchedProductId
        : null;

    if (matchedProductId) {
      // Остаток в этом отчёте не выгружается — берём то, что уже есть от
      // импорта "Остатки на складе" (если он уже загружался), а не затираем.
      const existing = await prisma.productStockAnalytics.findUnique({
        where: { marketplaceId_mpSku: { marketplaceId: marketplace.id, mpSku: row.vendorArticle } },
      });
      const qtyAvailable = existing?.qtyAvailable ?? 0;

      const avgDailySalesQty = row.qtyOrdered / DEFAULT_PERIOD_DAYS;
      const avgPriceRub =
        row.qtyDelivered > 0
          ? row.revenueDeliveredRub / row.qtyDelivered
          : row.qtyOrdered > 0
            ? row.revenueOrderedRub / row.qtyOrdered
            : null;
      const daysOfStockLeft =
        avgDailySalesQty > 0 ? Math.round(qtyAvailable / avgDailySalesQty) : null;

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
          qtyAvailable,
          avgPriceRub,
        },
        update: {
          productId: matchedProductId,
          daysOfStockLeft,
          avgDailySalesQty,
          qtyAvailable,
          avgPriceRub,
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
