import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import WarehouseForm from "../WarehouseForm";

export const dynamic = "force-dynamic";

export default async function EditWarehousePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireTenantSession();
  return runWithTenant(session, () => EditWarehousePageContent(params));
}

async function EditWarehousePageContent(params: { id: string }) {
  const [warehouse, marketplaces] = await Promise.all([
    prisma.warehouse.findUnique({ where: { id: params.id } }),
    prisma.marketplace.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!warehouse) notFound();

  return (
    <div>
      <h1>Редактирование склада</h1>
      <WarehouseForm
        marketplaces={marketplaces}
        initial={{
          id: warehouse.id,
          name: warehouse.name,
          type: warehouse.type,
          marketplaceId: warehouse.marketplaceId ?? "",
        }}
      />
    </div>
  );
}
