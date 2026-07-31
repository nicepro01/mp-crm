import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { fetchPhotoPng, EXCEL_PHOTO_SIZE_PX } from "@/lib/excelPhoto";

// Полный список товаров ОДНОГО конкретного магазина (marketplaceId, не
// код — различает два магазина одной площадки) — чтобы отдать менеджеру на
// ревизию: что уже не продаётся и пора в архив. Остаток/продажи в день —
// из последнего синка остатков, чтобы решение можно было принять сразу по
// файлу, не заходя в приложение. Пустая колонка "Решение" — заполняется
// вручную, дальше по ней и архивируют нужные листинги в приложении.
const PHOTO_SIZE_PX = EXCEL_PHOTO_SIZE_PX;
const PHOTO_ROW_HEIGHT_PT = 50;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent(req, { params }));
}

async function GETContent(_req: NextRequest, { params }: { params: { id: string } }) {
  const marketplace = await prisma.marketplace.findUnique({ where: { id: params.id } });
  if (!marketplace) {
    return NextResponse.json({ error: "Площадка не найдена" }, { status: 404 });
  }

  const [listings, stockAnalytics] = await Promise.all([
    prisma.mpListing.findMany({
      where: { marketplaceId: params.id },
      include: { product: true },
      orderBy: { product: { name: "asc" } },
    }),
    prisma.productStockAnalytics.findMany({ where: { marketplaceId: params.id } }),
  ]);

  const stockByMpSku = new Map(stockAnalytics.map((s) => [s.mpSku, s]));

  type Row = {
    photoUrl: string | null;
    vendorCode: string;
    sku: string;
    name: string;
    mpSku: string;
    qtyAvailable: number | null;
    avgDailySalesQty: number | null;
    daysWithoutSales: number | null;
    isActive: boolean;
  };
  const rows: Row[] = listings.map((l) => {
    const stock = stockByMpSku.get(l.mpSku);
    return {
      photoUrl: l.product.photoUrl,
      vendorCode: l.product.vendorCode ?? "—",
      sku: l.product.sku,
      name: l.product.name,
      mpSku: l.mpSku,
      qtyAvailable: stock?.qtyAvailable ?? null,
      avgDailySalesQty: stock ? Number(stock.avgDailySalesQty) : null,
      daysWithoutSales: stock?.daysWithoutSales ?? null,
      isActive: l.isActive,
    };
  });

  // Худшие продажи — первыми, чтобы кандидаты на архив сразу были сверху.
  rows.sort((a, b) => (a.avgDailySalesQty ?? -1) - (b.avgDailySalesQty ?? -1));

  const photoBuffers = await Promise.all(rows.map((r) => fetchPhotoPng(r.photoUrl)));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(marketplace.name.slice(0, 31));

  sheet.columns = [
    { width: 11 }, // фото
    { width: 16 }, // артикул
    { width: 12 }, // sku
    { width: 40 }, // товар
    { width: 14 }, // mpSku
    { width: 12 }, // остаток
    { width: 12 }, // продаж/день
    { width: 14 }, // дней без продаж
    { width: 12 }, // статус
    { width: 24 }, // решение
  ];

  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  const headerLabels = [
    "Фото",
    "Артикул",
    "SKU",
    "Товар",
    "SKU площадки",
    "Остаток",
    "Продаж/день",
    "Дней без продаж",
    "Статус",
    "Решение (архивировать?)",
  ];
  const headerRow = sheet.addRow(headerLabels);
  headerRow.font = { bold: true };
  headerRow.fill = headerFill;

  rows.forEach((r, i) => {
    const row = sheet.addRow([
      "",
      r.vendorCode,
      r.sku,
      r.name,
      r.mpSku,
      r.qtyAvailable ?? "",
      r.avgDailySalesQty ?? "",
      r.daysWithoutSales ?? "",
      r.isActive ? "Активен" : "Архив",
      "",
    ]);
    row.height = PHOTO_ROW_HEIGHT_PT;

    const png = photoBuffers[i];
    if (png) {
      const imageId = workbook.addImage({ buffer: png as any, extension: "png" });
      sheet.addImage(imageId, {
        tl: { col: 0.05, row: row.number - 1 + 0.05 },
        ext: { width: PHOTO_SIZE_PX, height: PHOTO_SIZE_PX },
      });
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);
  const safeName = marketplace.name.replace(/[^a-zA-Zа-яА-Я0-9]+/g, "-");

  return new NextResponse(buffer as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tovary-${safeName}-${dateStr}.xlsx"`,
    },
  });
}
