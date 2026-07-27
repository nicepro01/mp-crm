import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import MpListingForm from "../MpListingForm";

export const dynamic = "force-dynamic";

export default async function NewMpListingPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => NewMpListingPageContent());
}

async function NewMpListingPageContent() {
  const [products, marketplaces] = await Promise.all([
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true },
    }),
    prisma.marketplace.findMany({
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  return (
    <div>
      <h1>Новый листинг</h1>
      {products.length === 0 ? (
        <p className="error">Сначала добавьте хотя бы один товар.</p>
      ) : marketplaces.length === 0 ? (
        <p className="error">
          Сначала добавьте хотя бы одну площадку на странице «Площадки».
        </p>
      ) : (
        <MpListingForm products={products} marketplaces={marketplaces} />
      )}
    </div>
  );
}
