import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";

export async function GET() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent());
}

async function GETContent() {
  const batches = await prisma.batch.findMany({
    include: { items: { include: { product: true, supplier: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(batches);
}

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  try {
    const batch = await prisma.batch.create({
      data: {
        companyId: getCurrentCompanyId(),
        batchNumber: data.batchNumber,
        orderDate: new Date(data.orderDate),
        shipmentDate: data.shipmentDate ? new Date(data.shipmentDate) : null,
        etaDate: data.etaDate ? new Date(data.etaDate) : null,
        arrivedDate: data.arrivedDate ? new Date(data.arrivedDate) : null,
        logisticsStatus: data.logisticsStatus,
        notes: data.notes || null,
      },
    });
    return NextResponse.json(batch, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось создать поставку" },
      { status: 400 }
    );
  }
}
