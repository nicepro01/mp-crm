import type { Marketplace } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentCompanyId } from "./tenantContext";
import { fetchWbNmIdToVendorCode, fetchWbClaims, WbClaim } from "./wbApi";

// Извлечено из app/api/returns/sync-wb/route.ts без изменений в логике —
// см. lib/unitEconomicsSync.ts для объяснения зачем.
export async function syncWbReturns(marketplace: Marketplace) {
  const [nmIdMap, active, archived] = await Promise.all([
    fetchWbNmIdToVendorCode(marketplace.id),
    fetchWbClaims(marketplace.id, false),
    fetchWbClaims(marketplace.id, true),
  ]);

  const claims: WbClaim[] = [...active, ...archived];
  const summary = { total: claims.length, updated: 0, matched: 0, unmatched: 0 };

  for (const claim of claims) {
    const card = nmIdMap.get(claim.nm_id);
    const vendorCode = card?.vendorCode.trim();
    const product = vendorCode ? await prisma.product.findFirst({ where: { vendorCode } }) : null;

    if (product) summary.matched++;
    else summary.unmatched++;

    await prisma.returnClaim.upsert({
      where: { marketplaceId_externalId: { marketplaceId: marketplace.id, externalId: claim.id } },
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

  return summary;
}
