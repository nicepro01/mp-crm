import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { parseOzonUnitEconomicsFile, OzonUnitEconomicsRow } from "@/lib/unitEconomicsImport";

// Дата, на которую актуальны тарифы в файле (см. "с 6 апреля 2026" в
// названиях листов справочников комиссий/логистики).
const PERIOD_MONTH = new Date("2026-04-01T00:00:00.000Z");

function toPct(fraction: number | null): number | null {
  return fraction === null ? null : fraction * 100;
}

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

  let rows: OzonUnitEconomicsRow[];
  try {
    rows = await parseOzonUnitEconomicsFile(buffer);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось прочитать файл: ${err.message ?? "неизвестная ошибка"}` },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "Не удалось распознать файл — не нашли листы «ЮЭ RS» / «ЮЭ Gral» с ожидаемой структурой калькулятора юнит-экономики",
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

  const summary = { total: 0, updated: 0, dimensionsUpdated: 0, listingUpdated: 0, notFound: 0 };
  const notFoundCodes: string[] = [];

  for (const row of rows) {
    summary.total++;

    const product = await prisma.product.findFirst({ where: { vendorCode: row.vendorCode } });
    if (!product) {
      summary.notFound++;
      notFoundCodes.push(row.vendorCode);
      continue;
    }

    // Реальные габариты есть только на листе "ЮЭ RS" — заполняем ими вместо
    // заглушек (см/мм), вес в файле не выгружается, его не трогаем.
    if (row.lengthCm && row.widthCm && row.heightCm) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          itemLengthMm: Math.round(row.lengthCm * 10),
          itemWidthMm: Math.round(row.widthCm * 10),
          itemHeightMm: Math.round(row.heightCm * 10),
        },
      });
      summary.dimensionsUpdated++;
    }

    // Комиссия/логистика Ozon — только если у товара уже есть листинг на
    // Ozon (для товаров без реальных продаж там пока нечего обновлять).
    const listing = await prisma.mpListing.findFirst({
      where: { productId: product.id, marketplaceId: marketplace.id },
    });
    if (listing) {
      await prisma.mpListing.update({
        where: { id: listing.id },
        data: {
          commissionPct: row.mpCommissionPct !== null ? row.mpCommissionPct * 100 : listing.commissionPct,
          logisticsFeeRub: row.totalLogisticsRub ?? listing.logisticsFeeRub,
          currentPrice: row.sellPriceRub ?? listing.currentPrice,
        },
      });
      summary.listingUpdated++;
    }

    const details = {
      batchQty: row.batchQty,
      purchasePriceRubFromFile: row.purchasePriceRub,
      volumeL: row.volumeL,
      lengthCm: row.lengthCm,
      widthCm: row.widthCm,
      heightCm: row.heightCm,
      supplyCluster: row.supplyCluster,
      deliveryCluster: row.deliveryCluster,
      baseTariffRub: row.baseTariffRub,
      markupRub: row.markupRub,
      fbsHandlingRub: row.fbsHandlingRub,
      deliveryHandoutRub: row.deliveryHandoutRub,
      totalDeliveryLogisticsRub: row.totalDeliveryLogisticsRub,
      returnLogisticsRub: row.returnLogisticsRub,
      logisticsPctOfRevenue: toPct(row.logisticsPctOfRevenue),
      otherFeesPct: toPct(row.otherFeesPct),
      totalOzonDeductionsRub: row.totalOzonDeductionsRub,
      totalOzonDeductionsPct: toPct(row.totalOzonDeductionsPct),
      coInvestPct: toPct(row.coInvestPct),
      taxSystem: row.taxSystem,
      taxRatePct: toPct(row.taxRate),
      revenueRub: row.revenueRub,
      vatPct: toPct(row.vatPct),
      vatRub: row.vatRub,
      taxBaseRub: row.taxBaseRub,
      taxAmountRub: row.taxAmountRub,
      taxPctOfRevenue: toPct(row.taxPctOfRevenue),
      profitPerBatchRub: row.profitPerBatchRub,
      roiPct: toPct(row.roiPct),
    };

    await prisma.unitEconomics.upsert({
      where: {
        productId_marketplaceId_periodMonth: {
          productId: product.id,
          marketplaceId: marketplace.id,
          periodMonth: PERIOD_MONTH,
        },
      },
      create: {
        companyId: getCurrentCompanyId(),
        productId: product.id,
        marketplace: "OZON",
        marketplaceId: marketplace.id,
        periodMonth: PERIOD_MONTH,
        cogsRub: row.cogsPerUnitRub ?? 0,
        inboundLogisticsRub: 0,
        mpCommissionPct: toPct(row.mpCommissionPct),
        mpCommissionRub: row.mpCommissionRub ?? 0,
        mpLogisticsRub: row.totalLogisticsRub ?? 0,
        storageRub: 0,
        acquiringRub: row.acquiringRub,
        otherFeesRub: row.otherFeesRub,
        taxRub: row.totalTaxRub ?? 0,
        buybackPct: row.buybackPct,
        payoutRub: row.payoutRub,
        schemeType: row.schemeType,
        sellPriceRub: row.sellPriceRub ?? 0,
        netMarginRub: row.profitPerUnitRub ?? 0,
        netMarginPct: toPct(row.netMarginPct) ?? 0,
        details,
      },
      update: {
        cogsRub: row.cogsPerUnitRub ?? 0,
        mpCommissionPct: toPct(row.mpCommissionPct),
        mpCommissionRub: row.mpCommissionRub ?? 0,
        mpLogisticsRub: row.totalLogisticsRub ?? 0,
        acquiringRub: row.acquiringRub,
        otherFeesRub: row.otherFeesRub,
        taxRub: row.totalTaxRub ?? 0,
        buybackPct: row.buybackPct,
        payoutRub: row.payoutRub,
        schemeType: row.schemeType,
        sellPriceRub: row.sellPriceRub ?? 0,
        netMarginRub: row.profitPerUnitRub ?? 0,
        netMarginPct: toPct(row.netMarginPct) ?? 0,
        details,
        calculatedAt: new Date(),
      },
    });
    summary.updated++;
  }

  return NextResponse.json({ ...summary, notFoundCodes });
}
