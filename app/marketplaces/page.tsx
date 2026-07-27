import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { EditIconLink, DeleteIconButton } from "@/app/components/RowIconActions";

export const dynamic = "force-dynamic";

const codeLabels: Record<string, string> = {
  WB: "Wildberries",
  OZON: "Ozon",
  YANDEX_MARKET: "Яндекс.Маркет",
};

export default async function MarketplacesPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => MarketplacesPageContent());
}

async function MarketplacesPageContent() {
  const marketplaces = await prisma.marketplace.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { listings: true } } },
  });

  return (
    <div>
      <div className="toolbar">
        <h1>Площадки</h1>
        <a className="btn" href="/marketplaces/new">+ Новая площадка</a>
      </div>

      {marketplaces.length === 0 ? (
        <p className="muted">
          Пока нет ни одной площадки. Добавьте WB / Ozon / Яндекс.Маркет —
          это нужно для листингов и авто-подстановки в юнит-экономике.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Код</th>
              <th>Название</th>
              <th>Листингов</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {marketplaces.map((m) => (
              <tr key={m.id}>
                <td>{codeLabels[m.code] ?? m.code}</td>
                <td>{m.name}</td>
                <td>{m._count.listings}</td>
                <td className="row-actions">
                  <EditIconLink href={`/marketplaces/${m.id}`} />
                  <DeleteIconButton
                    endpoint={`/api/marketplaces/${m.id}`}
                    confirmMessage="Удалить эту площадку?"
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
