"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ProductPicker from "@/app/components/ProductPicker";

type Product = { id: string; sku: string; name: string };

type Allocation = {
  id: string;
  qty: number;
  unitCostRub: string;
  batchNumber: string;
};

type OrderItem = {
  id: string;
  qty: number;
  priceRub: string;
  product: Product;
  cogsAllocations: Allocation[];
};

function fmt(n: number) {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export default function OrderItemsSection({
  orderId,
  products,
  items,
}: {
  orderId: string;
  products: Product[];
  items: OrderItem[];
}) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [priceRub, setPriceRub] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) {
      setError("Выберите товар");
      return;
    }
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/orders/${orderId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, qty: Number(qty), priceRub }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка сохранения");
      return;
    }

    setProductId("");
    setQty("");
    setPriceRub("");
    router.refresh();
  }

  async function handleDelete(itemId: string) {
    if (!confirm("Удалить эту позицию заказа? Списание FIFO будет отменено.")) return;
    const res = await fetch(`/api/order-items/${itemId}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Не удалось удалить");
    }
  }

  let orderTotalRevenue = 0;
  let orderTotalCogs = 0;

  return (
    <div style={{ marginTop: 32 }}>
      <h1>Позиции заказа</h1>

      {items.length === 0 ? (
        <p className="muted">Пока нет ни одной позиции.</p>
      ) : (
        <table style={{ marginBottom: 20 }}>
          <thead>
            <tr>
              <th>Товар</th>
              <th>Кол-во</th>
              <th>Цена, ₽/шт</th>
              <th>Выручка, ₽</th>
              <th>Себестоимость (FIFO), ₽</th>
              <th>Маржа, ₽ / %</th>
              <th>Списано с поставок</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const revenue = item.qty * Number(item.priceRub);
              const cogs = item.cogsAllocations.reduce(
                (sum, a) => sum + a.qty * Number(a.unitCostRub),
                0
              );
              const margin = revenue - cogs;
              const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;

              orderTotalRevenue += revenue;
              orderTotalCogs += cogs;

              return (
                <tr key={item.id}>
                  <td>
                    {item.product.sku}
                    <div className="muted">{item.product.name}</div>
                  </td>
                  <td>{item.qty}</td>
                  <td>{item.priceRub}</td>
                  <td>{fmt(revenue)}</td>
                  <td>{fmt(cogs)}</td>
                  <td>
                    {fmt(margin)} ₽ / {fmt(marginPct)}%
                  </td>
                  <td>
                    {item.cogsAllocations.map((a) => (
                      <div key={a.id} className="muted">
                        {a.batchNumber} × {a.qty} ({a.unitCostRub} ₽/шт)
                      </div>
                    ))}
                  </td>
                  <td className="actions">
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleDelete(item.id)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <strong>Итого</strong>
              </td>
              <td>
                <strong>{fmt(orderTotalRevenue)}</strong>
              </td>
              <td>
                <strong>{fmt(orderTotalCogs)}</strong>
              </td>
              <td>
                <strong>{fmt(orderTotalRevenue - orderTotalCogs)} ₽</strong>
              </td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      )}

      <form onSubmit={handleAdd} style={{ maxWidth: 480 }}>
        <div className="muted">
          Добавить позицию — себестоимость спишется автоматически по FIFO
        </div>
        {error && <div className="error">{error}</div>}

        <label>
          Товар *
          <ProductPicker products={products} value={productId} onChange={setProductId} />
        </label>

        <div className="row">
          <label>
            Кол-во *
            <input
              required
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <label>
            Цена продажи, ₽/шт *
            <input
              required
              type="number"
              step="0.01"
              value={priceRub}
              onChange={(e) => setPriceRub(e.target.value)}
            />
          </label>
        </div>

        <div className="actions">
          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Сохранение…" : "Добавить"}
          </button>
        </div>
      </form>
    </div>
  );
}
