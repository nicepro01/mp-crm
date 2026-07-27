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
  const batch = await prisma.batch.findUnique({
    where: { id: params.id },
    include: { items: { include: { product: true, supplier: true } } },
  });
  if (!batch) {
    return NextResponse.json({ error: "Поставка не найдена" }, { status: 404 });
  }
  return NextResponse.json(batch);
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
    const batch = await prisma.batch.update({
      where: { id: params.id },
      data: {
        batchNumber: data.batchNumber,
        orderDate: new Date(data.orderDate),
        shipmentDate: data.shipmentDate ? new Date(data.shipmentDate) : null,
        etaDate: data.etaDate ? new Date(data.etaDate) : null,
        arrivedDate: data.arrivedDate ? new Date(data.arrivedDate) : null,
        logisticsStatus: data.logisticsStatus,
        notes: data.notes || null,
      },
    });

    return NextResponse.json(batch);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить поставку" },
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
    await prisma.batch.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось удалить поставку" },
      { status: 400 }
    );
  }
}
