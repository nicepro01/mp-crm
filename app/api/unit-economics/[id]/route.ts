import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { computeMargin } from "@/lib/unitEconomics";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent(_req, { params }));
}

async function GETContent(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const record = await prisma.unitEconomics.findUnique({
    where: { id: params.id },
    include: { product: true },
  });
  if (!record) {
    return NextResponse.json({ error: "Расчёт не найден" }, { status: 404 });
  }
  return NextResponse.json(record);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => PUTContent(req, { params }));
}

async function PUTContent(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const data = await req.json();

  try {
    const { netMarginRub, netMarginPct } = computeMargin(data);

    const record = await prisma.unitEconomics.update({
      where: { id: params.id },
      data: {
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
        calculatedAt: new Date(),
      },
    });
    return NextResponse.json(record);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить расчёт" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => DELETEContent(_req, { params }));
}

async function DELETEContent(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.unitEconomics.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось удалить расчёт" },
      { status: 400 }
    );
  }
}
