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
  const supplier = await prisma.supplier.findUnique({ where: { id: params.id } });
  if (!supplier) {
    return NextResponse.json({ error: "Поставщик не найден" }, { status: 404 });
  }
  return NextResponse.json(supplier);
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
    const supplier = await prisma.supplier.update({
      where: { id: params.id },
      data: {
        name: data.name,
        contactInfo: data.contactInfo || null,
        paymentTerms: data.paymentTerms || null,
        moq: data.moq === "" || data.moq === null ? null : Number(data.moq),
        leadTimeDays:
          data.leadTimeDays === "" || data.leadTimeDays === null
            ? null
            : Number(data.leadTimeDays),
        rating:
          data.rating === "" || data.rating === null ? null : Number(data.rating),
        notes: data.notes || null,
      },
    });
    return NextResponse.json(supplier);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить поставщика" },
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
    await prisma.supplier.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось удалить поставщика" },
      { status: 400 }
    );
  }
}
