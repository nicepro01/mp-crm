import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { fetchPhotoPng, EXCEL_PHOTO_SIZE_PX } from "@/lib/excelPhoto";

// Простой список "что едет и когда" по поставкам в статусе "В пути" — чтобы
// скинуть сотрудникам, которые спрашивают про сроки прихода товара. Не
// путать с warehouse-export (там сложная раскладка ОДНОЙ поставки по
// площадкам/складам) — здесь просто плоская таблица по всем едущим
// поставкам сразу, по одной строке на позицию.
function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString("ru-RU") : "";
}

const PHOTO_SIZE_PX = EXCEL_PHOTO_SIZE_PX;
const PHOTO_ROW_HEIGHT_PT = 50;

export async function GET() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent());
}

async function GETContent() {
  const batches = await prisma.batch.findMany({
    where: { logisticsStatus: "IN_TRANSIT" },
    include: { items: { include: { product: true, supplier: true } } },
    orderBy: [{ etaDate: "asc" }, { batchNumber: "asc" }],
  });

  // Фото — сетевой запрос на товар, тянем все параллельно заранее (тот же
  // приём, что и в warehouse-export/plan-export).
  const allItems = batches.flatMap((b) => b.items);
  const photoBuffers = await Promise.all(allItems.map((i) => fetchPhotoPng(i.product.photoUrl)));
  const photoByItemId = new Map(allItems.map((i, idx) => [i.id, photoBuffers[idx]]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("В пути");

  sheet.columns = [
    { width: 11 }, // фото
    { width: 18 }, // накладная
    { width: 16 }, // дата отгрузки
    { width: 18 }, // ожидаемое прибытие
    { width: 22 }, // поставщик
    { width: 16 }, // артикул
    { width: 40 }, // товар
    { width: 12 }, // количество
    { width: 30 }, // комментарий
  ];

  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  const headerLabels = [
    "Фото",
    "Накладная",
    "Дата отгрузки",
    "Ожидаемое прибытие",
    "Поставщик",
    "Артикул",
    "Товар",
    "Количество, шт",
    "Комментарий",
  ];
  const headerRow = sheet.addRow(headerLabels);
  headerRow.font = { bold: true };
  headerRow.fill = headerFill;

  if (batches.length === 0) {
    sheet.addRow(["", "Сейчас нет поставок в статусе «В пути»"]);
  }

  for (const batch of batches) {
    if (batch.items.length === 0) {
      sheet.addRow([
        "",
        batch.batchNumber,
        fmtDate(batch.shipmentDate),
        fmtDate(batch.etaDate),
        "",
        "",
        "(в поставке нет товаров)",
        "",
        batch.notes ?? "",
      ]);
      continue;
    }
    for (const item of batch.items) {
      const row = sheet.addRow([
        "",
        batch.batchNumber,
        fmtDate(batch.shipmentDate),
        fmtDate(batch.etaDate),
        item.supplier?.name ?? "—",
        item.product.vendorCode ?? item.product.sku,
        item.product.name,
        item.qty,
        batch.notes ?? "",
      ]);
      row.height = PHOTO_ROW_HEIGHT_PT;

      const png = photoByItemId.get(item.id);
      if (png) {
        const imageId = workbook.addImage({ buffer: png as any, extension: "png" });
        sheet.addImage(imageId, {
          tl: { col: 0.05, row: row.number - 1 + 0.05 },
          ext: { width: PHOTO_SIZE_PX, height: PHOTO_SIZE_PX },
        });
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="v-puti-${dateStr}.xlsx"`,
    },
  });
}
