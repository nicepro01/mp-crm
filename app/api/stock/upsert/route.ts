import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  try {
    const stock = await prisma.stock.upsert({
      where: {
        productId_warehouseId: {
          productId: data.productId,
          warehouseId: data.warehouseId,
        },
      },
      create: {
        companyId: getCurrentCompanyId(),
        productId: data.productId,
        warehouseId: data.warehouseId,
        qtyAvailable: Number(data.qtyAvailable) || 0,
        qtyReserved: Number(data.qtyReserved) || 0,
        qtyInTransit: Number(data.qtyInTransit) || 0,
        syncSource: "manual",
      },
      update: {
        qtyAvailable: Number(data.qtyAvailable) || 0,
        qtyReserved: Number(data.qtyReserved) || 0,
        qtyInTransit: Number(data.qtyInTransit) || 0,
        syncSource: "manual",
        syncedAt: new Date(),
      },
    });
    return NextResponse.json(stock);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось сохранить остаток" },
      { status: 400 }
    );
  }
}
