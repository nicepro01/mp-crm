import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import MpListingForm from "../MpListingForm";

export const dynamic = "force-dynamic";

export default async function EditMpListingPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireTenantSession();
  return runWithTenant(session, () => EditMpListingPageContent(params));
}

async function EditMpListingPageContent(params: { id: string }) {
  const [listing, products, marketplaces] = await Promise.all([
    prisma.mpListing.findUnique({ where: { id: params.id } }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true },
    }),
    prisma.marketplace.findMany({
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  if (!listing) notFound();

  return (
    <div>
      <h1>Редактирование листинга</h1>
      <MpListingForm
        products={products}
        marketplaces={marketplaces}
        initial={{
          id: listing.id,
          productId: listing.productId,
          marketplaceId: listing.marketplaceId,
          mpSku: listing.mpSku,
          mpProductId: listing.mpProductId ?? "",
          commissionPct: listing.commissionPct.toString(),
          logisticsFeeRub: listing.logisticsFeeRub?.toString() ?? "",
          storageFeeRub: listing.storageFeeRub?.toString() ?? "",
          currentPrice: listing.currentPrice?.toString() ?? "",
          isActive: listing.isActive,
        }}
      />
    </div>
  );
}
