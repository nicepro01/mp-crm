import { NextRequest, NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { computeWarehouseDistribution, buildWarehouseDistributionWorkbook } from "@/lib/warehouseDistribution";

// То же самое, что и app/api/batches/[id]/warehouse-export — раскладка по
// площадкам/городам для кладовщика, только ДО оформления поставки: строки
// планировщика ещё не стали BatchItem, поэтому qty приходит прямо из тела
// запроса (то, что закупщик уже проставил в колонке "Заказать, шт").
export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const body = await req.json();
  const items: { productId: string; qty: number }[] = Array.isArray(body.items)
    ? body.items.filter((i: any) => i?.productId && Number(i.qty) > 0).map((i: any) => ({ productId: i.productId, qty: Number(i.qty) }))
    : [];

  if (items.length === 0) {
    return NextResponse.json({ error: "Нет отмеченных товаров с заполненным количеством" }, { status: 400 });
  }

  const results = await computeWarehouseDistribution(items);
  const workbook = await buildWarehouseDistributionWorkbook(results);

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sklad-plan-${dateStr}.xlsx"`,
    },
  });
}
