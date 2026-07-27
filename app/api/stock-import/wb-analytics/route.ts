import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { parseWbAnalyticsFile } from "@/lib/wbImport";
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
    rows = await parseWbAnalyticsFile(buffer);
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
          "Не удалось распознать файл — это не похоже на отчёт «Оборачиваемость» из WB (нет листа «Товары» с колонками «Артикул продавца» / «Артикул WB»)",
      },
      { status: 400 }
    );
  }

  const marketplace = await prisma.marketplace.findFirst({ where: { code: "WB" } });
  if (!marketplace) {
    return NextResponse.json(
      { error: "Площадка WB не найдена — сначала добавьте её на странице «Площадки»" },
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
      // У WB нет готового "дней до конца остатка" — считаем сами по тому
      // же принципу, что и у Ozon: остаток / среднесуточные продажи.
      const totalStock = row.stockWbQty + row.stockOwnQty;
      const daysOfStockLeft =
        row.avgDailyOrders > 0 ? Math.round(totalStock / row.avgDailyOrders) : null;

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
          avgDailySalesQty: row.avgDailyOrders,
          daysWithoutSales: null,
          qtyAvailable: totalStock,
          avgPriceRub: row.avgPriceRub,
        },
        update: {
          productId: matchedProductId,
          daysOfStockLeft,
          avgDailySalesQty: row.avgDailyOrders,
          qtyAvailable: totalStock,
          avgPriceRub: row.avgPriceRub,
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
