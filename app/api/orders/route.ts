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
  const orders = await prisma.order.findMany({
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(orders);
}

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  try {
    const order = await prisma.order.create({
      data: {
        companyId: getCurrentCompanyId(),
        channel: data.channel,
        externalId: data.externalId || null,
        orderDate: new Date(data.orderDate),
        status: data.status,
        customerName: data.customerName || null,
      },
    });
    return NextResponse.json(order, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось создать заказ" },
      { status: 400 }
    );
  }
}
