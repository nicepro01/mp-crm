import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { ensureWarehousesSeeded } from "@/lib/warehouseSeed";
import { EditIconLink, DeleteIconButton } from "@/app/components/RowIconActions";

export const dynamic = "force-dynamic";

const typeLabels: Record<string, string> = {
  OWN_B2B: "Свой склад (B2B)",
  MARKETPLACE_FBO: "FBO маркетплейса",
  MARKETPLACE_FBS: "FBS маркетплейса",
};

export default async function WarehousesPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => WarehousesPageContent());
}

async function WarehousesPageContent() {
  await ensureWarehousesSeeded();

  const warehouses = await prisma.warehouse.findMany({
    include: { marketplace: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <div className="toolbar">
        <h1>Склады</h1>
        <a className="btn" href="/warehouses/new">+ Новый склад</a>
      </div>

      <p className="muted">
        Свой склад (B2B) и склады FBO/FBS для каждой площадки создаются
        автоматически. Здесь можно добавить дополнительные склады вручную.
      </p>

      <table>
        <thead>
          <tr>
            <th>Название</th>
            <th>Тип</th>
            <th>Площадка</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {warehouses.map((w) => (
            <tr key={w.id}>
              <td>{w.name}</td>
              <td>{typeLabels[w.type] ?? w.type}</td>
              <td>{w.marketplace?.name ?? "—"}</td>
              <td className="row-actions">
                <EditIconLink href={`/warehouses/${w.id}`} />
                <DeleteIconButton
                  endpoint={`/api/warehouses/${w.id}`}
                  confirmMessage="Удалить этот склад?"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
