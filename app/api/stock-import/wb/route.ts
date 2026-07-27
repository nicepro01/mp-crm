import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { parseWbStockFile } from "@/lib/wbImport";
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
    rows = await parseWbStockFile(buffer);
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
          "Не удалось распознать файл — это не похоже на отчёт «Остатки» из WB (ожидался лист с колонками «Бренд», «Артикул продавца», «Всего находится на складах»)",
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

  const warehouse = await prisma.warehouse.findFirst({
    where: { marketplaceId: marketplace.id, type: "MARKETPLACE_FBO" },
  });
  if (!warehouse) {
    return NextResponse.json(
      { error: "Склад WB FBO не найден — откройте страницу «Склады», он создастся автоматически" },
      { status: 400 }
    );
  }

  // В отчёте WB "Остатки" уже одна строка на артикул продавца (суммарно
  // по всем складам WB) — в отличие от Ozon, агрегировать вручную не нужно.
  const summary = { total: 0, updated: 0, pending: 0, skipped: 0 };
  const pendingCodes: string[] = [];

  for (const row of rows) {
    summary.total++;

    const outcome = await upsertImportItem({
      marketplaceId: marketplace.id,
      mpSku: row.vendorArticle, // числового ID в этом отчёте WB нет — ключ по артикулу продавца
      barcode: null, // в отчёте WB нет штрихкода
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
          syncSource: "wb_xlsx_import",
        },
        update: {
          qtyAvailable: row.qty,
          syncSource: "wb_xlsx_import",
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
