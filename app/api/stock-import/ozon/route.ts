import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { parseOzonStockFile } from "@/lib/ozonImport";
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

  let parsed;
  try {
    parsed = await parseOzonStockFile(buffer);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось прочитать файл: ${err.message ?? "неизвестная ошибка"}` },
      { status: 400 }
    );
  }

  if (parsed.format === "unknown") {
    return NextResponse.json(
      {
        error:
          "Не удалось распознать формат файла — это не похоже на отчёт «Остатки» (Оборотная ведомость) или «Оборачиваемость» (лист «Товар-склад») из Ozon",
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

  // Ozon делит остаток на десятки региональных складов, а наша модель
  // держит один общий бакет "Ozon FBO" — суммируем все региональные
  // строки одного SKU в одно число.
  const totalsBySku = new Map<
    string,
    { vendorCode: string; qty: number; warehouses: Set<string> }
  >();
  for (const row of parsed.rows) {
    const existing = totalsBySku.get(row.ozonSku);
    if (existing) {
      existing.qty += row.qty;
      existing.warehouses.add(row.warehouseName);
    } else {
      totalsBySku.set(row.ozonSku, {
        vendorCode: row.vendorCode,
        qty: row.qty,
        warehouses: new Set([row.warehouseName]),
      });
    }
  }

  const summary = { total: 0, updated: 0, pending: 0, skipped: 0 };
  const pendingCodes: string[] = [];

  for (const [ozonSku, agg] of totalsBySku) {
    summary.total++;

    const outcome = await upsertImportItem({
      marketplaceId: marketplace.id,
      mpSku: ozonSku,
      barcode: null, // в отчётах Ozon нет штрихкода
      name: agg.vendorCode || null,
      vendorCode: agg.vendorCode || null,
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
          qtyAvailable: agg.qty,
          syncSource: "ozon_xlsx_import",
        },
        update: {
          qtyAvailable: agg.qty,
          syncSource: "ozon_xlsx_import",
          syncedAt: new Date(),
        },
      });
      summary.updated++;
    } else if (outcome.status === "pending") {
      summary.pending++;
      pendingCodes.push(agg.vendorCode ? `${ozonSku} (${agg.vendorCode})` : ozonSku);
    } else {
      summary.skipped++;
    }
  }

  return NextResponse.json({
    ...summary,
    pendingCodes,
    detectedFormat: parsed.format,
    warehousesFound: new Set(parsed.rows.map((r) => r.warehouseName)).size,
  });
}
