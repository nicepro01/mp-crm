import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { computeWarehouseDistribution, buildWarehouseDistributionWorkbook } from "@/lib/warehouseDistribution";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent(req, { params }));
}

async function GETContent(req: NextRequest, { params }: { params: { id: string } }) {
  const batch = await prisma.batch.findUnique({ where: { id: params.id } });
  if (!batch) {
    return NextResponse.json({ error: "Поставка не найдена" }, { status: 404 });
  }

  const items = await prisma.batchItem.findMany({
    where: { batchId: params.id },
    orderBy: { createdAt: "asc" },
  });
  if (items.length === 0) {
    return NextResponse.json({ error: "В поставке нет товаров" }, { status: 400 });
  }

  const results = await computeWarehouseDistribution(items.map((i) => ({ productId: i.productId, qty: i.qty })));
  const workbook = await buildWarehouseDistributionWorkbook(results);

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sklad-${batch.batchNumber}-${dateStr}.xlsx"`,
    },
  });
}
