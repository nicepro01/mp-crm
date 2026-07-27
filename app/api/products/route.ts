import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";

export async function GET() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent());
}

async function GETContent() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(products);
}

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  try {
    const product = await prisma.product.create({
      data: {
        companyId: getCurrentCompanyId(),
        sku: data.sku,
        name: data.name,
        category: data.category || null,
        photoUrl: data.photoUrl || null,
        barcode: data.barcode || null,
        supplierId: data.supplierId || null,
        itemWeightG: data.itemWeightG,
        itemLengthMm: data.itemLengthMm,
        itemWidthMm: data.itemWidthMm,
        itemHeightMm: data.itemHeightMm,
        unitsPerBox: data.unitsPerBox,
        boxWeightKg: data.boxWeightKg,
        boxLengthMm: data.boxLengthMm,
        boxWidthMm: data.boxWidthMm,
        boxHeightMm: data.boxHeightMm,
        isActive: data.isActive ?? true,
        purchasePriceRub:
          data.purchasePriceRub !== undefined && data.purchasePriceRub !== ""
            ? Number(data.purchasePriceRub)
            : null,
        seasonalDemandMultiplier: data.seasonalDemandMultiplier ?? 1,
      },
    });
    return NextResponse.json(product, { status: 201 });
  } catch (err: any) {
    if (err.code === "P2002") {
      return NextResponse.json(
        { error: "Товар с таким SKU или штрихкодом уже существует" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: err.message ?? "Не удалось создать товар" },
      { status: 400 }
    );
  }
}
