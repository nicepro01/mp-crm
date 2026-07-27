import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { ensureWarehousesSeeded } from "@/lib/warehouseSeed";

export async function GET() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent());
}

async function GETContent() {
  await ensureWarehousesSeeded();
  const warehouses = await prisma.warehouse.findMany({
    include: { marketplace: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(warehouses);
}

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  try {
    const warehouse = await prisma.warehouse.create({
      data: {
        companyId: getCurrentCompanyId(),
        name: data.name,
        type: data.type,
        marketplaceId: data.type === "OWN_B2B" ? null : data.marketplaceId,
      },
    });
    return NextResponse.json(warehouse, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось создать склад" },
      { status: 400 }
    );
  }
}
