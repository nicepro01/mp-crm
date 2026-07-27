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
  const marketplace = await prisma.marketplace.findUnique({
    where: { id: params.id },
  });
  if (!marketplace) {
    return NextResponse.json({ error: "Площадка не найдена" }, { status: 404 });
  }
  return NextResponse.json(marketplace);
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
    const marketplace = await prisma.marketplace.update({
      where: { id: params.id },
      data: {
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.credentials !== undefined ? { credentials: data.credentials } : {}),
      },
    });

    // Название складов FBO/FBS отражает название площадки — держим в синхроне.
    await prisma.warehouse.updateMany({
      where: { marketplaceId: marketplace.id, type: "MARKETPLACE_FBO" },
      data: { name: `${marketplace.name} FBO` },
    });
    await prisma.warehouse.updateMany({
      where: { marketplaceId: marketplace.id, type: "MARKETPLACE_FBS" },
      data: { name: `${marketplace.name} FBS` },
    });

    return NextResponse.json(marketplace);
  } catch (err: any) {
    if (err.code === "P2002") {
      return NextResponse.json(
        { error: "Такая площадка уже добавлена" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить площадку" },
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
    await prisma.marketplace.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      {
        error:
          err.message ??
          "Не удалось удалить площадку — возможно, есть связанные листинги или склады",
      },
      { status: 400 }
    );
  }
}
