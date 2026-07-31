import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { parseOzonAnalyticsFile, parseOzonClusterAnalyticsFile } from "@/lib/ozonImport";
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
    rows = await parseOzonAnalyticsFile(buffer);
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
          "Не удалось распознать файл — это не похоже на отчёт «Оборачиваемость» из Ozon (нет листа «Товары»)",
      },
      { status: 400 }
    );
  }

  const marketplace = await prisma.marketplace.findFirst({ where: { code: "OZON" } });
  if (!marketplace) {
    return NextResponse.json(
      { error: "Площадка Ozon не найдена — сначала добавьте её на странице «Площадки»" },
      { status: 400 }
    );
  }

  const summary = { total: 0, updated: 0, pending: 0, skipped: 0 };
  const pendingCodes: string[] = [];
  const matchedProductIdBySku = new Map<string, string>();

  for (const row of rows) {
    summary.total++;

    const outcome = await upsertImportItem({
      marketplaceId: marketplace.id,
      mpSku: row.ozonSku,
      barcode: null, // в отчётах Ozon нет штрихкода
      name: row.name || row.vendorCode || null,
      vendorCode: row.vendorCode || null,
    });

    const matchedProductId =
      outcome.status === "matched" || (outcome.status === "skipped" && outcome.matchedProductId)
        ? (outcome as any).matchedProductId
        : null;

    if (matchedProductId) {
      matchedProductIdBySku.set(row.ozonSku, matchedProductId);
      await prisma.productStockAnalytics.upsert({
        where: {
          marketplaceId_mpSku: { marketplaceId: marketplace.id, mpSku: row.ozonSku },
        },
        create: {
          companyId: getCurrentCompanyId(),
          marketplaceId: marketplace.id,
          productId: matchedProductId,
          mpSku: row.ozonSku,
          liquidityStatus: row.liquidityStatus,
          daysOfStockLeft: row.daysOfStockLeft,
          avgDailySalesQty: row.avgDailySalesQty,
          daysWithoutSales: row.daysWithoutSales,
          qtyAvailable: row.qtyAvailable,
        },
        update: {
          productId: matchedProductId,
          liquidityStatus: row.liquidityStatus,
          daysOfStockLeft: row.daysOfStockLeft,
          avgDailySalesQty: row.avgDailySalesQty,
          daysWithoutSales: row.daysWithoutSales,
          qtyAvailable: row.qtyAvailable,
          syncedAt: new Date(),
        },
      });
      summary.updated++;
    } else if (outcome.status === "pending") {
      summary.pending++;
      pendingCodes.push(row.vendorCode ? `${row.ozonSku} (${row.vendorCode})` : row.ozonSku);
    } else {
      summary.skipped++;
    }
  }

  // Разрез по кластерам (регионам) — тот же файл, лист "Товар-кластер".
  // Сопоставление товаров уже сделано выше по листу "Товары" (тот же SKU),
  // повторно гонять upsertImportItem не нужно — просто переиспользуем карту.
  // Кластеров в отчёте обычно многие сотни строк — по одной на SKU+регион,
  // поэтому пишем всё одним batch-запросом, а не построчными upsert'ами
  // (иначе через пуловый коннекшн Supabase это уходит за минуту).
  let clusterRowsSaved = 0;
  const clusterRows = await parseOzonClusterAnalyticsFile(buffer);
  if (clusterRows) {
    const matchedRows = clusterRows
      .map((row) => ({ row, productId: matchedProductIdBySku.get(row.ozonSku) }))
      .filter((x): x is { row: (typeof clusterRows)[number]; productId: string } =>
        Boolean(x.productId)
      );

    if (matchedRows.length > 0) {
      const companyId = getCurrentCompanyId();
      const valuesSql = Prisma.join(
        matchedRows.map(
          ({ row, productId }) => Prisma.sql`(
            ${randomUUID()}, ${companyId}, ${marketplace.id}, ${productId}, ${row.ozonSku}, ${row.clusterName},
            ${row.liquidityStatus}, ${row.daysOfStockLeft}, ${row.avgDailySalesQty},
            ${row.daysWithoutSales}, ${row.qtyAvailable}, now()
          )`
        )
      );

      await prisma.$executeRaw`
        INSERT INTO product_cluster_analytics
          (id, "companyId", "marketplaceId", "productId", "mpSku", "clusterName", "liquidityStatus",
           "daysOfStockLeft", "avgDailySalesQty", "daysWithoutSales", "qtyAvailable", "syncedAt")
        VALUES ${valuesSql}
        ON CONFLICT ("marketplaceId", "mpSku", "clusterName")
        DO UPDATE SET
          "productId" = EXCLUDED."productId",
          "liquidityStatus" = EXCLUDED."liquidityStatus",
          "daysOfStockLeft" = EXCLUDED."daysOfStockLeft",
          "avgDailySalesQty" = EXCLUDED."avgDailySalesQty",
          "daysWithoutSales" = EXCLUDED."daysWithoutSales",
          "qtyAvailable" = EXCLUDED."qtyAvailable",
          "syncedAt" = now()
      `;
      clusterRowsSaved = matchedRows.length;
    }
  }

  return NextResponse.json({ ...summary, pendingCodes, clusterRowsSaved });
}
