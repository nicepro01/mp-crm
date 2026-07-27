import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";

export async function GET(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent(req));
}

async function GETContent(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");

  const listings = await prisma.mpListing.findMany({
    where: productId ? { productId } : undefined,
    include: { product: true, marketplace: true },
    orderBy: { mpSku: "asc" },
  });
  return NextResponse.json(listings);
}

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  try {
    const listing = await prisma.mpListing.create({
      data: {
        companyId: getCurrentCompanyId(),
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
    return NextResponse.json(listing, { status: 201 });
  } catch (err: any) {
    if (err.code === "P2002") {
      return NextResponse.json(
        { error: "Такой артикул на этой площадке уже добавлен" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: err.message ?? "Не удалось создать листинг" },
      { status: 400 }
    );
  }
}
