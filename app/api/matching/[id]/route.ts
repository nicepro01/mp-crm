import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";

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
    if (data.action === "match") {
      if (!data.productId) {
        return NextResponse.json({ error: "Не выбран товар" }, { status: 400 });
      }
      const item = await prisma.mpImportItem.update({
        where: { id: params.id },
        data: {
          status: "MATCHED",
          matchedProductId: data.productId,
          matchedVia: "manual",
          resolvedAt: new Date(),
        },
      });

      // Листинг связывает товар с площадкой (нужен для юнит-экономики —
      // комиссия/логистика/цена площадки) — заводим его сразу при
      // сопоставлении, а не только когда пользователь зайдёт в "Листинги".
      await prisma.mpListing.upsert({
        where: {
          marketplaceId_mpSku: { marketplaceId: item.marketplaceId, mpSku: item.mpSku },
        },
        create: {
          companyId: getCurrentCompanyId(),
          productId: data.productId,
          marketplaceId: item.marketplaceId,
          mpSku: item.mpSku,
          commissionPct: 0,
        },
        update: {
          productId: data.productId,
        },
      });

      return NextResponse.json(item);
    }

    if (data.action === "ignore") {
      const item = await prisma.mpImportItem.update({
        where: { id: params.id },
        data: {
          status: "IGNORED",
          resolvedAt: new Date(),
        },
      });
      return NextResponse.json(item);
    }

    if (data.action === "reset") {
      const item = await prisma.mpImportItem.update({
        where: { id: params.id },
        data: {
          status: "PENDING",
          matchedProductId: null,
          matchedVia: null,
          resolvedAt: null,
        },
      });
      return NextResponse.json(item);
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить запись" },
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
    await prisma.mpImportItem.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось удалить запись" },
      { status: 400 }
    );
  }
}
