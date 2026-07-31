import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { calcBatchSummary } from "@/lib/batchCalc";
import { EditIconLink, DeleteIconButton } from "@/app/components/RowIconActions";
import InTransitExportButton from "./InTransitExportButton";

export const dynamic = "force-dynamic";

const logisticsStatusLabels: Record<string, string> = {
  PLANNED: "Запланировано",
  PRODUCTION: "Производство",
  IN_TRANSIT: "В пути",
  CUSTOMS: "Таможня",
  ARRIVED: "Прибыло",
  RECEIVED: "Оприходовано",
};

function fmt(n: number) {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export default async function BatchesPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => BatchesPageContent());
}

async function BatchesPageContent() {
  const batches = await prisma.batch.findMany({
    include: { items: { include: { product: true, supplier: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="toolbar">
        <h1>Поставки из Китая</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <InTransitExportButton />
          <a className="btn btn-secondary" href="/batches/plan">Планировщик поставок</a>
          <a className="btn" href="/batches/new">+ Новая поставка</a>
        </div>
      </div>

      {batches.length === 0 ? (
        <p className="muted">Пока нет ни одной поставки.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Номер накладной</th>
                <th>Поставщики</th>
                <th>Дата заказа</th>
                <th>Дата отгрузки</th>
                <th>Дата прибытия</th>
                <th>Вес, кг</th>
                <th>Объём, м³</th>
                <th>Логистика</th>
                <th>Комментарий</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const summary = calcBatchSummary(
                  b.items.map((i) => ({
                    qty: i.qty,
                    purchasePriceRub: i.purchasePriceRub,
                    product: i.product,
                  }))
                );
                const supplierNames = Array.from(
                  new Set(
                    b.items
                      .map((i) => i.supplier?.name)
                      .filter((name): name is string => Boolean(name))
                  )
                );

                return (
                  <tr key={b.id}>
                    <td>{b.batchNumber}</td>
                    <td>{supplierNames.length > 0 ? supplierNames.join(", ") : "—"}</td>
                    <td>{b.orderDate.toISOString().slice(0, 10)}</td>
                    <td>
                      {b.shipmentDate ? b.shipmentDate.toISOString().slice(0, 10) : "—"}
                    </td>
                    <td>
                      {b.arrivedDate ? b.arrivedDate.toISOString().slice(0, 10) : "—"}
                    </td>
                    <td>{fmt(summary.totalWeightKg.toNumber())}</td>
                    <td>{fmt(summary.totalVolumeM3.toNumber())}</td>
                    <td>{logisticsStatusLabels[b.logisticsStatus]}</td>
                    <td style={{ maxWidth: 200 }}>{b.notes ?? "—"}</td>
                    <td className="row-actions">
                      <EditIconLink href={`/batches/${b.id}`} />
                      <DeleteIconButton
                        endpoint={`/api/batches/${b.id}`}
                        confirmMessage="Удалить эту поставку?"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
