import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { fetchPhotoPng, EXCEL_PHOTO_SIZE_PX } from "@/lib/excelPhoto";
import { allocateProportionally } from "@/lib/allocateProportionally";
import { computeSeasonalIndex, seasonalWeightForWindow } from "@/lib/seasonality";

// Та же логика, что и в Планировщике (app/batches/plan/page.tsx) — здесь не
// пересчитываем ЧТО заказать (это уже решено, qty фиксирован в BatchItem),
// а только КУДА физически развезти уже заказанное количество: сначала по
// площадкам, потом внутри площадки по городам/кластерам, пропорционально
// нехватке каждой цели (allocateProportionally). Товары без продаж за
// период тоже распределяем — просто вместо "нехватки по продажам" берём
// "нехватку до среднего остатка по площадке/складу" (выравнивание), это
// единственный сигнал, который есть, когда продаж нет вообще.
const DEFAULT_LEAD_TIME_DAYS = 120;

const marketplaceLabels: Record<string, string> = {
  WB: "Wildberries",
  OZON: "Ozon",
  YANDEX_MARKET: "Яндекс.Маркет",
};

const PHOTO_SIZE_PX = EXCEL_PHOTO_SIZE_PX;
const PHOTO_ROW_HEIGHT_PT = 50;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent(req, { params }));
}

async function GETContent(req: NextRequest, { params }: { params: { id: string } }) {
  const batch = await prisma.batch.findUnique({ where: { id: params.id } });
  if (!batch) {
    return NextResponse.json({ error: "Поставка не найдена" }, { status: 404 });
  }

  const items = await prisma.batchItem.findMany({
    where: { batchId: params.id },
    include: { product: { include: { supplier: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (items.length === 0) {
    return NextResponse.json({ error: "В поставке нет товаров" }, { status: 400 });
  }

  const productIds = items.map((i) => i.productId);

  const [listings, stockAnalytics, warehouseAnalytics, monthlySales] = await Promise.all([
    prisma.mpListing.findMany({
      where: { productId: { in: productIds }, isActive: true },
      include: { marketplace: { select: { code: true } } },
    }),
    prisma.productStockAnalytics.findMany({
      where: { productId: { in: productIds } },
      include: { marketplace: { select: { code: true } } },
    }),
    prisma.productWarehouseAnalytics.findMany({
      where: { productId: { in: productIds } },
      include: { marketplace: { select: { code: true } } },
    }),
    prisma.productMonthlySales.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true, month: true, qtySold: true, daysInPeriod: true },
    }),
  ]);

  const codesByProduct = new Map<string, Set<string>>();
  for (const l of listings) {
    const set = codesByProduct.get(l.productId) ?? new Set<string>();
    set.add(l.marketplace.code);
    codesByProduct.set(l.productId, set);
  }

  const stockByKey = new Map<string, { qtyAvailable: number; avgDaily: number }>();
  for (const s of stockAnalytics) {
    stockByKey.set(`${s.productId}|${s.marketplace.code}`, {
      qtyAvailable: s.qtyAvailable,
      avgDaily: Number(s.avgDailySalesQty),
    });
  }

  const warehousesByKey = new Map<string, { warehouseName: string; qtyAvailable: number; avgDaily: number }[]>();
  for (const w of warehouseAnalytics) {
    const key = `${w.productId}|${w.marketplace.code}`;
    const list = warehousesByKey.get(key) ?? [];
    list.push({
      warehouseName: w.warehouseName,
      qtyAvailable: w.qtyAvailable,
      avgDaily: Number(w.avgDailySalesQty),
    });
    warehousesByKey.set(key, list);
  }

  const monthlySalesByProduct = new Map<string, typeof monthlySales>();
  for (const m of monthlySales) {
    const list = monthlySalesByProduct.get(m.productId) ?? [];
    list.push(m);
    monthlySalesByProduct.set(m.productId, list);
  }

  type DistRow = {
    marketplaceLabel: string;
    warehouseName: string;
    qtyAvailable: number | null;
    avgDailySalesQty: number | null;
    qty: number;
  };
  type ProductResult = {
    productId: string;
    vendorCode: string;
    sku: string;
    name: string;
    photoUrl: string | null;
    totalQty: number;
    distribution: DistRow[];
    noSalesData: boolean; // нет продаж ни на одной площадке за период — распределено по остатку, не по спросу
  };
  const results: ProductResult[] = [];
  const today = new Date();

  for (const item of items) {
    const product = item.product;
    const codes = [...(codesByProduct.get(item.productId) ?? [])];
    const leadTimeDays = product.supplier?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS;

    const monthlyRows = monthlySalesByProduct.get(item.productId) ?? [];
    const seasonalIndex = computeSeasonalIndex(monthlyRows);
    const seasonalValue =
      seasonalIndex.size > 0
        ? seasonalWeightForWindow(seasonalIndex, today, leadTimeDays)
        : Number(product.seasonalDemandMultiplier);

    const totalAvgDaily = codes.reduce(
      (sum, code) => sum + (stockByKey.get(`${item.productId}|${code}`)?.avgDaily ?? 0),
      0
    );
    const noSalesData = totalAvgDaily <= 0;

    if (codes.length === 0) {
      // Не выставлен активно ни на одной площадке — распределять физически
      // некуда, показываем как есть, без разбивки.
      results.push({
        productId: item.productId,
        vendorCode: product.vendorCode ?? "—",
        sku: product.sku,
        name: product.name,
        photoUrl: product.photoUrl,
        totalQty: item.qty,
        distribution: [
          { marketplaceLabel: "—", warehouseName: "нет активных листингов", qtyAvailable: null, avgDailySalesQty: null, qty: item.qty },
        ],
        noSalesData,
      });
      continue;
    }

    const totalQtyAvailableAllMarketplaces = codes.reduce(
      (sum, code) => sum + (stockByKey.get(`${item.productId}|${code}`)?.qtyAvailable ?? 0),
      0
    );

    const mpWeights = codes.map((code) => {
      const stat = stockByKey.get(`${item.productId}|${code}`);
      const avgDaily = stat?.avgDaily ?? 0;
      const qtyAvailable = stat?.qtyAvailable ?? 0;
      // Нет продаж вообще нигде — ориентируемся на выравнивание остатка
      // между площадками (то же допущение, что и на уровне склада ниже),
      // а не на несуществующий спрос.
      const target = !noSalesData ? avgDaily * leadTimeDays * seasonalValue : totalQtyAvailableAllMarketplaces / codes.length;
      return Math.max(0, target - qtyAvailable);
    });
    const mpAllocations = allocateProportionally(item.qty, mpWeights);

    const distribution: DistRow[] = [];
    codes.forEach((code, i) => {
      const mpQty = mpAllocations[i];
      if (mpQty <= 0) return;
      const marketplaceLabel = marketplaceLabels[code] ?? code;
      const mpStat = stockByKey.get(`${item.productId}|${code}`);
      const warehouses = warehousesByKey.get(`${item.productId}|${code}`) ?? [];

      if (warehouses.length === 0) {
        distribution.push({
          marketplaceLabel,
          warehouseName: "нет данных по городам",
          qtyAvailable: mpStat?.qtyAvailable ?? null,
          avgDailySalesQty: mpStat?.avgDaily ?? null,
          qty: mpQty,
        });
        return;
      }

      const totalQtyAvailable = warehouses.reduce((sum, w) => sum + w.qtyAvailable, 0);
      const whWeights = warehouses.map((w) => {
        const target =
          w.avgDaily > 0 ? w.avgDaily * leadTimeDays * seasonalValue : totalQtyAvailable / warehouses.length;
        return Math.max(0, target - w.qtyAvailable);
      });
      const whAllocations = allocateProportionally(mpQty, whWeights);
      warehouses.forEach((w, j) => {
        if (whAllocations[j] <= 0) return;
        distribution.push({
          marketplaceLabel,
          warehouseName: w.warehouseName,
          qtyAvailable: w.qtyAvailable,
          avgDailySalesQty: w.avgDaily,
          qty: whAllocations[j],
        });
      });
    });

    results.push({
      productId: item.productId,
      vendorCode: product.vendorCode ?? "—",
      sku: product.sku,
      name: product.name,
      photoUrl: product.photoUrl,
      totalQty: item.qty,
      distribution,
      noSalesData,
    });
  }

  const photoBuffers = await Promise.all(results.map((r) => fetchPhotoPng(r.photoUrl)));
  const photoByProductId = new Map(results.map((r, i) => [r.productId, photoBuffers[i]]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Раскладка по складам");

  sheet.columns = [
    { width: 11 }, // фото
    { width: 16 }, // артикул
    { width: 12 }, // sku
    { width: 44 }, // товар
    { width: 16 }, // площадка
    { width: 26 }, // город/склад
    { width: 14 }, // остаток склада
    { width: 12 }, // продаж/день
    { width: 14 }, // количество
  ];

  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  const productFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
  const noticeFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };

  const headerLabels = [
    "Фото",
    "Артикул",
    "SKU",
    "Товар",
    "Площадка",
    "Город/склад",
    "Остаток склада",
    "Продаж/день",
    "Количество, шт",
  ];
  const lastCol = headerLabels.length;

  const headerRow = sheet.addRow(headerLabels);
  headerRow.font = { bold: true };
  headerRow.fill = headerFill;

  for (const r of results) {
    if (r.noSalesData) {
      const noticeRow = sheet.addRow([
        `${r.vendorCode} — нет продаж за последние 30 дней, распределено по остатку (не по спросу)`,
      ]);
      sheet.mergeCells(noticeRow.number, 1, noticeRow.number, lastCol);
      noticeRow.font = { italic: true };
      noticeRow.fill = noticeFill;
    }

    const firstRowNumber = sheet.rowCount + 1;
    for (const d of r.distribution) {
      const row = sheet.addRow([
        "",
        r.vendorCode,
        r.sku,
        r.name,
        d.marketplaceLabel,
        d.warehouseName,
        d.qtyAvailable ?? "",
        d.avgDailySalesQty || "",
        d.qty,
      ]);
      row.height = PHOTO_ROW_HEIGHT_PT;
    }
    const lastRowNumber = sheet.rowCount;

    const png = photoByProductId.get(r.productId);
    if (png) {
      const imageId = workbook.addImage({ buffer: png as any, extension: "png" });
      sheet.addImage(imageId, {
        tl: { col: 0.05, row: firstRowNumber - 1 + 0.05 },
        ext: { width: PHOTO_SIZE_PX, height: PHOTO_SIZE_PX },
      });
    }
    if (lastRowNumber > firstRowNumber) {
      sheet.mergeCells(firstRowNumber, 1, lastRowNumber, 1);
      sheet.mergeCells(firstRowNumber, 2, lastRowNumber, 2);
      sheet.mergeCells(firstRowNumber, 3, lastRowNumber, 3);
      sheet.mergeCells(firstRowNumber, 4, lastRowNumber, 4);
    }

    const subtotalRow = sheet.addRow(["", "", "", "", "", "Итого по товару", "", "", r.totalQty]);
    subtotalRow.font = { italic: true };
    subtotalRow.fill = productFill;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sklad-${batch.batchNumber}-${dateStr}.xlsx"`,
    },
  });
}
