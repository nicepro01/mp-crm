import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { allocateCogsFifo, InsufficientStockError } from "@/lib/fifo";

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
  const items = await prisma.orderItem.findMany({
    where: { orderId: params.id },
    include: { product: true, cogsAllocations: true },
    orderBy: { id: "asc" },
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

  let item;
  try {
    item = await prisma.orderItem.create({
      data: {
        companyId: getCurrentCompanyId(),
        orderId: params.id,
        productId: data.productId,
        qty: Number(data.qty),
        priceRub: data.priceRub,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось создать позицию заказа" },
      { status: 400 }
    );
  }

  try {
    await allocateCogsFifo(item.id);
  } catch (err: any) {
    // Списание не удалось (не хватает партий с рассчитанной себестоимостью) —
    // откатываем создание позиции, чтобы не оставлять "заказ без себестоимости".
    await prisma.orderItem.delete({ where: { id: item.id } });

    const status = err instanceof InsufficientStockError ? 400 : 500;
    return NextResponse.json(
      { error: err.message ?? "Не удалось списать себестоимость по FIFO" },
      { status }
    );
  }

  const withCogs = await prisma.orderItem.findUnique({
    where: { id: item.id },
    include: {
      product: true,
      cogsAllocations: { include: { batchItem: { include: { batch: true } } } },
    },
  });

  return NextResponse.json(withCogs, { status: 201 });
}
