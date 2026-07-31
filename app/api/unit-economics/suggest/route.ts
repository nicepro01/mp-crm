import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { suggestCogsRub } from "@/lib/cogsSuggestion";
import { suggestMpListingCosts } from "@/lib/mpListingSuggestion";

export async function GET(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent(req));
}

async function GETContent(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");
  const periodMonth = searchParams.get("periodMonth"); // "YYYY-MM"
  // marketplace — код площадки (для канала заказов, см. suggestCogsRub);
  // marketplaceId — конкретный магазин (для листинга, см. suggestMpListingCosts)
  // — разные понятия, оба нужны, т.к. у одного кода может быть 2+ магазина.
  const marketplace = searchParams.get("marketplace");
  const marketplaceId = searchParams.get("marketplaceId");

  if (!productId || !periodMonth) {
    return NextResponse.json(
      { error: "productId и periodMonth обязательны" },
      { status: 400 }
    );
  }

  const date = new Date(`${periodMonth}-01T00:00:00.000Z`);
  const [product, fifo, listing] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, select: { purchasePriceRub: true } }),
    suggestCogsRub(productId, date, marketplace || null),
    suggestMpListingCosts(productId, marketplaceId || null),
  ]);

  return NextResponse.json({
    purchasePriceRub: product?.purchasePriceRub ? product.purchasePriceRub.toString() : null,
    fifo,
    listing,
  });
}
