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
  const supplierId = searchParams.get("supplierId");

  const prices = await prisma.supplierPrice.findMany({
    where: {
      ...(productId ? { productId } : {}),
      ...(supplierId ? { supplierId } : {}),
    },
    include: { supplier: true, product: true },
    orderBy: { priceCny: "asc" },
  });
  return NextResponse.json(prices);
}

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  try {
    const price = await prisma.supplierPrice.create({
      data: {
        companyId: getCurrentCompanyId(),
        supplierId: data.supplierId,
        productId: data.productId,
        priceCny: data.priceCny,
        validFrom: new Date(data.validFrom),
        validTo: data.validTo ? new Date(data.validTo) : null,
        minQty: data.minQty ? Number(data.minQty) : null,
      },
    });
    return NextResponse.json(price, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось добавить цену поставщика" },
      { status: 400 }
    );
  }
}
