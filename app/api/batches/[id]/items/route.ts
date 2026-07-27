import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { calculateAndSaveUnitCost } from "@/lib/unitCost";
import { syncProductPurchasePrice } from "@/lib/productCostSync";

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
  const items = await prisma.batchItem.findMany({
    where: { batchId: params.id },
    include: { product: true, unitCost: true, supplier: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(items);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req, { params }));
}

async function POSTContent(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const data = await req.json();

  try {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      select: { supplierId: true },
    });

    const item = await prisma.batchItem.create({
      data: {
        companyId: getCurrentCompanyId(),
        batchId: params.id,
        productId: data.productId,
        // Поставщик берётся из основного поставщика товара, а не выбирается
        // на позиции — может быть null, если у товара он ещё не указан.
        supplierId: product.supplierId,
        qty: Number(data.qty),
        purchasePriceRub: data.purchasePriceRub,
      },
    });

    await calculateAndSaveUnitCost(item.id);
    await syncProductPurchasePrice(item.id);

    const withCost = await prisma.batchItem.findUnique({
      where: { id: item.id },
      include: { product: true, unitCost: true, supplier: true },
    });

    return NextResponse.json(withCost, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось добавить позицию поставки" },
      { status: 400 }
    );
  }
}
