import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import MarketplaceForm from "../MarketplaceForm";

export const dynamic = "force-dynamic";

export default async function NewMarketplacePage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => NewMarketplacePageContent());
}

async function NewMarketplacePageContent() {
  const existing = await prisma.marketplace.findMany({ select: { code: true } });

  return (
    <div>
      <h1>Новая площадка</h1>
      <MarketplaceForm usedCodes={existing.map((m) => m.code)} />
    </div>
  );
}
