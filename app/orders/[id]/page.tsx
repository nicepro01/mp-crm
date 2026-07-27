import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import OrderItemsSection from "../OrderItemsSection";

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

export default async function OrderDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireTenantSession();
  return runWithTenant(session, () => OrderDetailPageContent(params));
}

async function OrderDetailPageContent(params: { id: string }) {
  const [order, products, items] = await Promise.all([
    prisma.order.findUnique({ where: { id: params.id } }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true },
    }),
    prisma.orderItem.findMany({
      where: { orderId: params.id },
      include: {
        product: true,
        cogsAllocations: { include: { batchItem: { include: { batch: true } } } },
      },
      orderBy: { id: "asc" },
    }),
  ]);

  if (!order) notFound();

  return (
    <div>
      <h1>Заказ от {order.orderDate.toISOString().slice(0, 10)}</h1>
      <p className="muted">
        Канал: {channelLabels[order.channel]} · Статус: {statusLabels[order.status]}
        {order.customerName ? ` · Покупатель: ${order.customerName}` : ""}
        {order.externalId ? ` · Внешний ID: ${order.externalId}` : ""}
      </p>

      <OrderItemsSection
        orderId={order.id}
        products={products}
        items={items.map((item) => ({
          id: item.id,
          qty: item.qty,
          priceRub: item.priceRub.toString(),
          product: {
            id: item.product.id,
            sku: item.product.sku,
            name: item.product.name,
          },
          cogsAllocations: item.cogsAllocations.map((a) => ({
            id: a.id,
            qty: a.qty,
            unitCostRub: a.unitCostRub.toString(),
            batchNumber: a.batchItem.batch.batchNumber,
          })),
        }))}
      />
    </div>
  );
}
