import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import WarehouseForm from "../WarehouseForm";

export const dynamic = "force-dynamic";

export default async function NewWarehousePage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => NewWarehousePageContent());
}

async function NewWarehousePageContent() {
  const marketplaces = await prisma.marketplace.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div>
      <h1>Новый склад</h1>
      <WarehouseForm marketplaces={marketplaces} />
    </div>
  );
}
