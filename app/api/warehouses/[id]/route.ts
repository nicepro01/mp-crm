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
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: params.id },
    include: { marketplace: true },
  });
  if (!warehouse) {
    return NextResponse.json({ error: "Склад не найден" }, { status: 404 });
  }
  return NextResponse.json(warehouse);
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
    const warehouse = await prisma.warehouse.update({
      where: { id: params.id },
      data: {
        name: data.name,
        type: data.type,
        marketplaceId: data.type === "OWN_B2B" ? null : data.marketplaceId,
      },
    });
    return NextResponse.json(warehouse);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить склад" },
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
    await prisma.warehouse.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      {
        error:
          err.message ??
          "Не удалось удалить склад — возможно, на нём есть остатки товаров",
      },
      { status: 400 }
    );
  }
}
