import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { fetchWbNmIdToVendorCode, fetchWbClaims, WbClaim } from "@/lib/wbApi";

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent());
}

async function POSTContent() {
  const marketplace = await prisma.marketplace.findFirst({ where: { code: "WB" } });
  if (!marketplace) {
    return NextResponse.json(
      { error: "Площадка WB не найдена — сначала добавьте её на странице «Площадки»" },
      { status: 400 }
    );
  }

  let nmIdMap, active, archived;
  try {
    [nmIdMap, active, archived] = await Promise.all([
      fetchWbNmIdToVendorCode(),
      fetchWbClaims(false),
      fetchWbClaims(true),
    ]);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от WB API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }

  const claims: WbClaim[] = [...active, ...archived];
  const summary = { total: claims.length, updated: 0, matched: 0, unmatched: 0 };

  for (const claim of claims) {
    const card = nmIdMap.get(claim.nm_id);
    const vendorCode = card?.vendorCode.trim();
    const product = vendorCode
      ? await prisma.product.findFirst({ where: { vendorCode } })
      : null;

    if (product) summary.matched++;
    else summary.unmatched++;

    await prisma.returnClaim.upsert({
      where: {
        marketplaceId_externalId: { marketplaceId: marketplace.id, externalId: claim.id },
      },
      create: {
        companyId: getCurrentCompanyId(),
        marketplaceId: marketplace.id,
        productId: product?.id ?? null,
        externalId: claim.id,
        mpSku: String(claim.nm_id),
        productName: claim.imt_name || null,
        status: claim.status,
        reasonText: claim.user_comment,
        priceRub: claim.price,
        photos: claim.photos ?? undefined,
        orderDate: claim.order_dt ? new Date(claim.order_dt) : null,
        claimDate: new Date(claim.dt),
      },
      update: {
        productId: product?.id ?? null,
        status: claim.status,
        reasonText: claim.user_comment,
        priceRub: claim.price,
        photos: claim.photos ?? undefined,
        syncedAt: new Date(),
      },
    });
    summary.updated++;
  }

  return NextResponse.json(summary);
}
