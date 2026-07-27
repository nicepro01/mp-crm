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
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { items: { include: { product: true } } },
  });
  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }
  return NextResponse.json(order);
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
    const order = await prisma.order.update({
      where: { id: params.id },
      data: {
        channel: data.channel,
        externalId: data.externalId || null,
        orderDate: new Date(data.orderDate),
        status: data.status,
        customerName: data.customerName || null,
      },
    });
    return NextResponse.json(order);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить заказ" },
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
    // Удаляем заказ вместе с позициями и списаниями по FIFO —
    // это "отменяет" продажу и возвращает партии в доступный остаток.
    await prisma.$transaction(async (tx) => {
      const items = await tx.orderItem.findMany({
        where: { orderId: params.id },
        select: { id: true },
      });
      const itemIds = items.map((i) => i.id);
      await tx.cogsAllocation.deleteMany({ where: { orderItemId: { in: itemIds } } });
      await tx.orderItem.deleteMany({ where: { orderId: params.id } });
      await tx.order.delete({ where: { id: params.id } });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось удалить заказ" },
      { status: 400 }
    );
  }
}
