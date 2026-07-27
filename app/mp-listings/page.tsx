import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { MarketplaceCode } from "@prisma/client";
import { EditIconLink, DeleteIconButton } from "@/app/components/RowIconActions";

export const dynamic = "force-dynamic";

const marketplaceOptions: { code: string; label: string }[] = [
  { code: "", label: "Все площадки" },
  { code: "WB", label: "Wildberries" },
  { code: "OZON", label: "Ozon" },
  { code: "YANDEX_MARKET", label: "Яндекс.Маркет" },
];

const statusOptions: { value: string; label: string }[] = [
  { value: "", label: "Все" },
  { value: "active", label: "Активные" },
  { value: "archived", label: "Архив" },
];

function filterLinkStyle(active: boolean): React.CSSProperties {
  return {
    background: "none",
    border: "none",
    borderBottom: active ? "2px solid var(--link)" : "2px solid transparent",
    color: active ? "var(--link)" : "var(--fg)",
    fontWeight: active ? 600 : 500,
    fontSize: 14,
    padding: "8px 14px",
    marginBottom: -1,
    display: "inline-block",
  };
}

export default async function MpListingsPage({
  searchParams,
}: {
  searchParams: { mp?: string; status?: string };
}) {
  const session = await requireTenantSession();
  return runWithTenant(session, () => MpListingsPageContent(searchParams));
}

async function MpListingsPageContent(searchParams: { mp?: string; status?: string }) {
  const mp = searchParams.mp ?? "";
  const status = searchParams.status ?? "";

  const allListings = await prisma.mpListing.findMany({
    where: mp ? { marketplace: { code: mp as MarketplaceCode } } : {},
    include: { product: true, marketplace: true },
    orderBy: [{ product: { name: "asc" } }, { mpSku: "asc" }],
  });

  const listings = allListings.filter((l) => {
    if (status === "active") return l.isActive;
    if (status === "archived") return !l.isActive;
    return true;
  });

  function buildHref(next: { mp?: string; status?: string }) {
    const params = new URLSearchParams();
    const nextMp = next.mp !== undefined ? next.mp : mp;
    const nextStatus = next.status !== undefined ? next.status : status;
    if (nextMp) params.set("mp", nextMp);
    if (nextStatus) params.set("status", nextStatus);
    const qs = params.toString();
    return qs ? `/mp-listings?${qs}` : "/mp-listings";
  }

  return (
    <div>
      <div className="toolbar">
        <h1>Листинги на маркетплейсах</h1>
        <a className="btn" href="/mp-listings/new">+ Новый листинг</a>
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
        {marketplaceOptions.map((opt) => (
          <a key={opt.code} href={buildHref({ mp: opt.code })} style={filterLinkStyle(mp === opt.code)}>
            {opt.label}
          </a>
        ))}
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
        {statusOptions.map((opt) => (
          <a key={opt.value} href={buildHref({ status: opt.value })} style={filterLinkStyle(status === opt.value)}>
            {opt.label}
          </a>
        ))}
      </div>

      <p className="muted" style={{ marginTop: -12, marginBottom: 16 }}>
        Показано: {listings.length}
      </p>

      {listings.length === 0 ? (
        <p className="muted">
          {mp || status
            ? "По выбранному фильтру ничего не найдено."
            : "Пока нет ни одного листинга. Листинг связывает товар с площадкой и хранит комиссию, логистику МП, хранение и цену — это позволяет автоматически подставлять их в юнит-экономику."}
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Товар</th>
                <th>Площадка</th>
                <th>Артикул МП</th>
                <th>Комиссия, %</th>
                <th>Логистика, ₽</th>
                <th>Хранение, ₽</th>
                <th>Цена, ₽</th>
                <th>Активен</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.product.sku}
                    <div className="muted">{l.product.name}</div>
                  </td>
                  <td>{l.marketplace.name}</td>
                  <td>{l.mpSku}</td>
                  <td>{l.commissionPct.toString()}</td>
                  <td>{l.logisticsFeeRub?.toString() ?? "—"}</td>
                  <td>{l.storageFeeRub?.toString() ?? "—"}</td>
                  <td>{l.currentPrice?.toString() ?? "—"}</td>
                  <td>{l.isActive ? "Да" : "Нет"}</td>
                  <td className="row-actions">
                    <EditIconLink href={`/mp-listings/${l.id}`} />
                    <DeleteIconButton
                      endpoint={`/api/mp-listings/${l.id}`}
                      confirmMessage="Удалить этот листинг?"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
