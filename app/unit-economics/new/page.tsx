import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import UnitEconomicsForm from "../UnitEconomicsForm";

export const dynamic = "force-dynamic";

export default async function NewUnitEconomicsPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => NewUnitEconomicsPageContent());
}

async function NewUnitEconomicsPageContent() {
  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    select: { id: true, sku: true, name: true },
  });

  return (
    <div>
      <h1>Новый расчёт юнит-экономики</h1>
      {products.length === 0 ? (
        <p className="error">Сначала добавьте хотя бы один товар.</p>
      ) : (
        <UnitEconomicsForm products={products} />
      )}
    </div>
  );
}
