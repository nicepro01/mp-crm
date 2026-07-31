import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { fetchPhotoPng, EXCEL_PHOTO_SIZE_PX } from "@/lib/excelPhoto";

type ExportItem = {
  productId: string;
  qty: number;
  purchasePriceRub: number;
  // Ключ — marketplaceId, а не code: два магазина одной площадки (Ozon/Ozon 2)
  // делят один code, колонка по коду смешивала бы их количества в одну.
  marketplaceQty?: Record<string, number>;
};

const PHOTO_SIZE_PX = EXCEL_PHOTO_SIZE_PX;
const PHOTO_ROW_HEIGHT_PT = 50;

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const body = await req.json();
  const items: ExportItem[] = Array.isArray(body.items) ? body.items : [];
  // marketplaceId -> название (напр. "Ozon"/"Ozon 2") — приходит от клиента,
  // где оно уже собрано из реальных строк Marketplace для этой компании.
  const marketplaceNames: Record<string, string> =
    body.marketplaceNames && typeof body.marketplaceNames === "object" ? body.marketplaceNames : {};
  if (items.length === 0) {
    return NextResponse.json({ error: "Нет отмеченных товаров" }, { status: 400 });
  }

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i) => i.productId) } },
    include: { supplier: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  // Только те площадки, что реально встретились среди выбранных товаров —
  // не показываем пустую колонку под площадку, на которой ничего не заказываем.
  const marketplaceIdsPresent = [
    ...new Set(items.flatMap((i) => Object.keys(i.marketplaceQty ?? {}))),
  ].sort((a, b) => (marketplaceNames[a] ?? a).localeCompare(marketplaceNames[b] ?? b, "ru"));

  type Row = {
    photoUrl: string | null;
    vendorCode: string;
    sku: string;
    name: string;
    qty: number;
    marketplaceQty: Record<string, number>;
    price: number;
    sum: number;
    boxes: number;
    weightKg: number;
    volumeM3: number;
  };
  type Group = { supplierName: string; contactInfo: string | null; rows: Row[] };
  const groups = new Map<string, Group>();

  for (const item of items) {
    const p = productById.get(item.productId);
    if (!p) continue;
    const supplierName = p.supplier?.name ?? "Без поставщика";
    const group = groups.get(supplierName) ?? {
      supplierName,
      contactInfo: p.supplier?.contactInfo ?? null,
      rows: [],
    };
    const boxes = Math.ceil(item.qty / p.unitsPerBox);
    const boxVolumeM3 = (p.boxLengthMm * p.boxWidthMm * p.boxHeightMm) / 1_000_000_000;
    group.rows.push({
      photoUrl: p.photoUrl,
      vendorCode: p.vendorCode ?? "—",
      sku: p.sku,
      name: p.name,
      qty: item.qty,
      marketplaceQty: item.marketplaceQty ?? {},
      price: item.purchasePriceRub,
      sum: Math.round(item.qty * item.purchasePriceRub * 100) / 100,
      boxes,
      weightKg: Math.round(boxes * Number(p.boxWeightKg) * 100) / 100,
      volumeM3: Math.round(boxes * boxVolumeM3 * 1000) / 1000,
    });
    groups.set(supplierName, group);
  }

  const sortedGroups = [...groups.values()].sort((a, b) => {
    if (a.supplierName === "Без поставщика") return 1;
    if (b.supplierName === "Без поставщика") return -1;
    return a.supplierName.localeCompare(b.supplierName, "ru");
  });

  // Фото — сетевой запрос на товар, тянем все параллельно заранее.
  const allRows = sortedGroups.flatMap((g) => g.rows);
  const photoBuffers = await Promise.all(allRows.map((r) => fetchPhotoPng(r.photoUrl)));
  const photoByRow = new Map(allRows.map((r, i) => [r, photoBuffers[i]]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Закупка");

  sheet.columns = [
    { width: 11 }, // фото
    { width: 16 }, // артикул
    { width: 12 }, // sku
    { width: 50 }, // товар
    { width: 10 }, // кол-во общее
    ...marketplaceIdsPresent.map(() => ({ width: 12 })),
    { width: 14 }, // цена
    { width: 14 }, // сумма
    { width: 10 }, // коробок
    { width: 10 }, // вес
    { width: 10 }, // объём
  ];

  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  const supplierFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };

  const headerLabels = [
    "Фото",
    "Артикул",
    "SKU",
    "Товар",
    "Кол-во всего",
    ...marketplaceIdsPresent.map((id) => marketplaceNames[id] ?? id),
    "Цена закупки, ₽",
    "Сумма, ₽",
    "Коробок",
    "Вес, кг",
    "Объём, м³",
  ];
  const lastCol = headerLabels.length;

  let grandQty = 0;
  let grandSum = 0;
  let grandWeight = 0;
  let grandVolume = 0;
  let grandBoxes = 0;

  for (const group of sortedGroups) {
    const supplierRow = sheet.addRow([group.supplierName + (group.contactInfo ? ` — ${group.contactInfo}` : "")]);
    sheet.mergeCells(supplierRow.number, 1, supplierRow.number, lastCol);
    supplierRow.font = { bold: true };
    supplierRow.fill = supplierFill;

    const headerRow = sheet.addRow(headerLabels);
    headerRow.font = { bold: true };
    headerRow.fill = headerFill;

    let subQty = 0;
    let subSum = 0;
    let subWeight = 0;
    let subVolume = 0;
    let subBoxes = 0;

    for (const r of group.rows) {
      const row = sheet.addRow([
        "",
        r.vendorCode,
        r.sku,
        r.name,
        r.qty,
        ...marketplaceIdsPresent.map((id) => r.marketplaceQty[id] ?? ""),
        r.price,
        r.sum,
        r.boxes,
        r.weightKg,
        r.volumeM3,
      ]);
      row.height = PHOTO_ROW_HEIGHT_PT;

      const png = photoByRow.get(r);
      if (png) {
        const imageId = workbook.addImage({ buffer: png as any, extension: "png" });
        sheet.addImage(imageId, {
          tl: { col: 0.05, row: row.number - 1 + 0.05 },
          ext: { width: PHOTO_SIZE_PX, height: PHOTO_SIZE_PX },
        });
      }

      subQty += r.qty;
      subSum += r.sum;
      subWeight += r.weightKg;
      subVolume += r.volumeM3;
      subBoxes += r.boxes;
    }

    const subtotalRow = sheet.addRow([
      "",
      "",
      "",
      "Итого по поставщику",
      subQty,
      ...marketplaceIdsPresent.map(() => ""),
      "",
      Math.round(subSum * 100) / 100,
      subBoxes,
      Math.round(subWeight * 100) / 100,
      Math.round(subVolume * 1000) / 1000,
    ]);
    subtotalRow.font = { italic: true };

    sheet.addRow([]);

    grandQty += subQty;
    grandSum += subSum;
    grandWeight += subWeight;
    grandVolume += subVolume;
    grandBoxes += subBoxes;
  }

  const totalRow = sheet.addRow([
    "",
    "",
    "",
    "ИТОГО ПО ВСЕЙ ПОСТАВКЕ",
    grandQty,
    ...marketplaceIdsPresent.map(() => ""),
    "",
    Math.round(grandSum * 100) / 100,
    grandBoxes,
    Math.round(grandWeight * 100) / 100,
    Math.round(grandVolume * 1000) / 1000,
  ]);
  totalRow.font = { bold: true };
  totalRow.fill = headerFill;

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="zakupka-${dateStr}.xlsx"`,
    },
  });
}
