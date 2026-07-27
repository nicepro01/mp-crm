import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { EditIconLink, DeleteIconButton } from "@/app/components/RowIconActions";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => SuppliersPageContent());
}

async function SuppliersPageContent() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="toolbar">
        <h1>Поставщики</h1>
        <a className="btn" href="/suppliers/new">+ Новый поставщик</a>
      </div>

      {suppliers.length === 0 ? (
        <p className="muted">Пока нет ни одного поставщика.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Контакты</th>
              <th>MOQ</th>
              <th>Срок, дн.</th>
              <th>Рейтинг</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.contactInfo ?? "—"}</td>
                <td>{s.moq ?? "—"}</td>
                <td>{s.leadTimeDays ?? "—"}</td>
                <td>{s.rating ?? "—"}</td>
                <td className="row-actions">
                  <EditIconLink href={`/suppliers/${s.id}`} />
                  <DeleteIconButton
                    endpoint={`/api/suppliers/${s.id}`}
                    confirmMessage="Удалить этого поставщика?"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
