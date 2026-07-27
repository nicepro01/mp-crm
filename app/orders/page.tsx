import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { EditIconLink, DeleteIconButton } from "@/app/components/RowIconActions";

export const dynamic = "force-dynamic";

const channelLabels: Record<string, string> = {
  B2B: "B2B",
  WB: "Wildberries",
  OZON: "Ozon",
  YANDEX_MARKET: "Яндекс.Маркет",
};

const statusLabels: Record<string, string> = {
  NEW: "Новый",
  CONFIRMED: "Подтверждён",
  SHIPPED: "Отгружен",
  DELIVERED: "Доставлен",
  CANCELLED: "Отменён",
  RETURNED: "Возврат",
};

export default async function OrdersPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => OrdersPageContent());
}

async function OrdersPageContent() {
  const orders = await prisma.order.findMany({
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="toolbar">
        <h1>Заказы</h1>
        <a className="btn" href="/orders/new">+ Новый заказ</a>
      </div>

      {orders.length === 0 ? (
        <p className="muted">Пока нет ни одного заказа.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Канал</th>
              <th>Покупатель</th>
              <th>Статус</th>
              <th>Позиций</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{o.orderDate.toISOString().slice(0, 10)}</td>
                <td>{channelLabels[o.channel]}</td>
                <td>{o.customerName ?? "—"}</td>
                <td>{statusLabels[o.status]}</td>
                <td>{o.items.length}</td>
                <td className="row-actions">
                  <EditIconLink href={`/orders/${o.id}`} title="Открыть" />
                  <DeleteIconButton
                    endpoint={`/api/orders/${o.id}`}
                    confirmMessage="Удалить этот заказ? Списанная себестоимость будет отменена."
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
