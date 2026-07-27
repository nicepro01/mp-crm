import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { calculateAndSaveUnitCost } from "@/lib/unitCost";
import { syncProductPurchasePrice } from "@/lib/productCostSync";

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
    const consumed = await prisma.cogsAllocation.aggregate({
      where: { batchItemId: params.id },
      _sum: { qty: true },
    });
    const consumedQty = consumed._sum.qty ?? 0;
    const newQty = Number(data.qty);

    if (newQty < consumedQty) {
      return NextResponse.json(
        {
          error: `Нельзя уменьшить количество ниже уже списанного по FIFO (${consumedQty} шт.)`,
        },
        { status: 400 }
      );
    }

    const current = await prisma.batchItem.findUniqueOrThrow({
      where: { id: params.id },
      select: { product: { select: { supplierId: true } } },
    });

    await prisma.batchItem.update({
      where: { id: params.id },
      data: {
        qty: newQty,
        purchasePriceRub: data.purchasePriceRub,
        // Поставщик пересинхронизируется из товара при каждом сохранении —
        // на случай, если основной поставщик товара с тех пор поменялся.
        supplierId: current.product.supplierId,
      },
    });

    await calculateAndSaveUnitCost(params.id);
    await syncProductPurchasePrice(params.id);

    const withCost = await prisma.batchItem.findUnique({
      where: { id: params.id },
      include: { product: true, unitCost: true, supplier: true },
    });

    return NextResponse.json(withCost);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить позицию поставки" },
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
    const consumed = await prisma.cogsAllocation.count({
      where: { batchItemId: params.id },
    });
    if (consumed > 0) {
      return NextResponse.json(
        {
          error:
            "Нельзя удалить: по этой позиции поставки уже проведено FIFO-списание себестоимости",
        },
        { status: 400 }
      );
    }

    await prisma.$transaction([
      prisma.unitCost.deleteMany({ where: { batchItemId: params.id } }),
      prisma.batchItem.delete({ where: { id: params.id } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось удалить позицию поставки" },
      { status: 400 }
    );
  }
}
