import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import MarketplaceForm from "../MarketplaceForm";

export const dynamic = "force-dynamic";

export default async function EditMarketplacePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireTenantSession();
  return runWithTenant(session, () => EditMarketplacePageContent(params));
}

async function EditMarketplacePageContent(params: { id: string }) {
  const [marketplace, existing] = await Promise.all([
    prisma.marketplace.findUnique({ where: { id: params.id } }),
    prisma.marketplace.findMany({ select: { code: true } }),
  ]);

  if (!marketplace) notFound();

  return (
    <div>
      <h1>Редактирование площадки</h1>
      <MarketplaceForm
        usedCodes={existing.map((m) => m.code)}
        initial={{ id: marketplace.id, code: marketplace.code, name: marketplace.name }}
      />
    </div>
  );
}
