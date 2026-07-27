import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { ensureMarketplaceWarehouses } from "@/lib/warehouseSeed";

export async function GET() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent());
}

async function GETContent() {
  const marketplaces = await prisma.marketplace.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(marketplaces);
}

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  try {
    const marketplace = await prisma.marketplace.create({
      data: {
        companyId: getCurrentCompanyId(),
        code: data.code,
        name: data.name,
      },
    });

    // Каждой площадке сразу заводим пару складов FBO/FBS —
    // без этого некуда будет фиксировать остатки на площадке.
    await ensureMarketplaceWarehouses(marketplace.id, marketplace.name);

    return NextResponse.json(marketplace, { status: 201 });
  } catch (err: any) {
    if (err.code === "P2002") {
      return NextResponse.json(
        { error: "Такая площадка уже добавлена" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: err.message ?? "Не удалось создать площадку" },
      { status: 400 }
    );
  }
}
