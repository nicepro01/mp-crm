import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";

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
  const listing = await prisma.mpListing.findUnique({
    where: { id: params.id },
    include: { product: true, marketplace: true },
  });
  if (!listing) {
    return NextResponse.json({ error: "Листинг не найден" }, { status: 404 });
  }
  return NextResponse.json(listing);
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
    const listing = await prisma.mpListing.update({
      where: { id: params.id },
      data: {
        productId: data.productId,
        marketplaceId: data.marketplaceId,
        mpSku: data.mpSku,
        mpProductId: data.mpProductId || null,
        commissionPct: data.commissionPct,
        logisticsFeeRub: data.logisticsFeeRub || null,
        storageFeeRub: data.storageFeeRub || null,
        currentPrice: data.currentPrice || null,
        isActive: data.isActive ?? true,
      },
    });
    return NextResponse.json(listing);
  } catch (err: any) {
    if (err.code === "P2002") {
      return NextResponse.json(
        { error: "Такой артикул на этой площадке уже добавлен" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить листинг" },
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
    await prisma.mpListing.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось удалить листинг" },
      { status: 400 }
    );
  }
}
