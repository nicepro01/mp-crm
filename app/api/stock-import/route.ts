import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { upsertImportItem } from "@/lib/matching";

type ImportRow = { mpSku: string; barcode?: string | null; qty: number };

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();
  const marketplaceId: string | undefined = data.marketplaceId;
  const warehouseType: string | undefined = data.warehouseType;
  const rows: ImportRow[] = Array.isArray(data.rows) ? data.rows : [];

  if (!marketplaceId) {
    return NextResponse.json({ error: "Выберите площадку" }, { status: 400 });
  }
  if (warehouseType !== "MARKETPLACE_FBO" && warehouseType !== "MARKETPLACE_FBS") {
    return NextResponse.json({ error: "Выберите склад FBO или FBS" }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "Файл не содержит строк для импорта" }, { status: 400 });
  }

  const warehouse = await prisma.warehouse.findFirst({
    where: { marketplaceId, type: warehouseType },
  });
  if (!warehouse) {
    return NextResponse.json(
      { error: "Склад для этой площадки не найден — проверьте страницу «Склады»" },
      { status: 400 }
    );
  }

  const summary = { total: 0, updated: 0, pending: 0, skipped: 0, invalid: 0 };
  const pendingCodes: string[] = [];

  for (const raw of rows) {
    const mpSku = String(raw.mpSku ?? "").trim();
    if (!mpSku) continue;
    summary.total++;

    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty < 0) {
      summary.invalid++;
      continue;
    }

    const barcode = raw.barcode ? String(raw.barcode).trim() || null : null;

    const outcome = await upsertImportItem({ marketplaceId, mpSku, barcode });

    if (outcome.status === "matched") {
      await prisma.stock.upsert({
        where: {
          productId_warehouseId: {
            productId: outcome.matchedProductId,
            warehouseId: warehouse.id,
          },
        },
        create: {
          companyId: getCurrentCompanyId(),
          productId: outcome.matchedProductId,
          warehouseId: warehouse.id,
          qtyAvailable: qty,
          syncSource: "csv_import",
        },
        update: {
          qtyAvailable: qty,
          syncSource: "csv_import",
          syncedAt: new Date(),
        },
      });
      summary.updated++;
    } else if (outcome.status === "pending") {
      summary.pending++;
      pendingCodes.push(mpSku);
    } else {
      // skipped — уже решено раньше (в т.ч. отмечено "игнорировать")
      if (outcome.matchedProductId) {
        await prisma.stock.upsert({
          where: {
            productId_warehouseId: {
              productId: outcome.matchedProductId,
              warehouseId: warehouse.id,
            },
          },
          create: {
            companyId: getCurrentCompanyId(),
            productId: outcome.matchedProductId,
            warehouseId: warehouse.id,
            qtyAvailable: qty,
            syncSource: "csv_import",
          },
          update: {
            qtyAvailable: qty,
            syncSource: "csv_import",
            syncedAt: new Date(),
          },
        });
        summary.updated++;
      } else {
        summary.skipped++;
      }
    }
  }

  return NextResponse.json({ ...summary, pendingCodes });
}
