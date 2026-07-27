import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { calculateAndSaveUnitCost } from "@/lib/unitCost";
import { syncProductPurchasePrice } from "@/lib/productCostSync";

type PlanItem = { productId: string; qty: number; purchasePriceRub: number };

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();
  const items: PlanItem[] = data.items ?? [];

  if (!data.batchNumber || !data.orderDate) {
    return NextResponse.json({ error: "Укажите номер поставки и дату заказа" }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "Не выбрано ни одного товара" }, { status: 400 });
  }

  let batchId: string;
  try {
    const batch = await prisma.batch.create({
      data: {
        companyId: getCurrentCompanyId(),
        batchNumber: data.batchNumber,
        orderDate: new Date(data.orderDate),
        logisticsStatus: "PLANNED",
      },
    });
    batchId = batch.id;

    for (const item of items) {
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: item.productId },
        select: { supplierId: true },
      });

      const batchItem = await prisma.batchItem.create({
        data: {
          companyId: getCurrentCompanyId(),
          batchId: batch.id,
          productId: item.productId,
          supplierId: product.supplierId,
          qty: item.qty,
          purchasePriceRub: item.purchasePriceRub,
        },
      });

      await calculateAndSaveUnitCost(batchItem.id);
      await syncProductPurchasePrice(batchItem.id);
    }
  } catch (err: any) {
    if (err.code === "P2002") {
      return NextResponse.json(
        { error: "Поставка с таким номером уже существует" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: err.message ?? "Не удалось создать поставку" },
      { status: 400 }
    );
  }

  return NextResponse.json({ id: batchId }, { status: 201 });
}
