import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { computeMargin } from "@/lib/unitEconomics";

export async function GET() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent());
}

async function GETContent() {
  const records = await prisma.unitEconomics.findMany({
    include: { product: true },
    orderBy: { calculatedAt: "desc" },
  });
  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  try {
    const { netMarginRub, netMarginPct } = computeMargin(data);

    const record = await prisma.unitEconomics.create({
      data: {
        companyId: getCurrentCompanyId(),
        productId: data.productId,
        marketplace: data.marketplace || null,
        periodMonth: new Date(`${data.periodMonth}-01T00:00:00.000Z`),
        cogsRub: data.cogsRub,
        inboundLogisticsRub: data.inboundLogisticsRub,
        mpCommissionRub: data.mpCommissionRub,
        mpLogisticsRub: data.mpLogisticsRub,
        storageRub: data.storageRub,
        adsRub: data.adsRub,
        taxRub: data.taxRub,
        laborAllocRub: data.laborAllocRub,
        sellPriceRub: data.sellPriceRub,
        netMarginRub,
        netMarginPct,
      },
    });
    return NextResponse.json(record, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось сохранить расчёт" },
      { status: 400 }
    );
  }
}
