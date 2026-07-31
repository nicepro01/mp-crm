import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";

// Простой список "что едет и когда" по поставкам в статусе "В пути" — чтобы
// скинуть сотрудникам, которые спрашивают про сроки прихода товара. Не
// путать с warehouse-export (там сложная раскладка ОДНОЙ поставки по
// площадкам/складам) — здесь просто плоская таблица по всем едущим
// поставкам сразу, по одной строке на позицию.
function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString("ru-RU") : "";
}

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

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("В пути");

  sheet.columns = [
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
    sheet.addRow(["Сейчас нет поставок в статусе «В пути»"]);
  }

  for (const batch of batches) {
    if (batch.items.length === 0) {
      sheet.addRow([
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
      sheet.addRow([
        batch.batchNumber,
        fmtDate(batch.shipmentDate),
        fmtDate(batch.etaDate),
        item.supplier?.name ?? "—",
        item.product.vendorCode ?? item.product.sku,
        item.product.name,
        item.qty,
        batch.notes ?? "",
      ]);
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
