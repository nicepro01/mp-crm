"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import PhotoThumb from "@/app/products/PhotoThumb";

export type ReorderRow = {
  productId: string;
  sku: string;
  name: string;
  photoUrl: string | null;
  qtyAvailable: number;
  avgDailySalesQty: number;
  daysOfStockLeft: number | null;
  recommendedOrderQty: number | null;
  purchasePriceRub: number | null;
};

type LineState = { selected: boolean; qty: string; price: string };

function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}

// Быстрое создание заказа прямо со вкладки "Пора заказывать" — вызывает тот
// же API, что и полный Планировщик поставок (/api/batches/plan), поэтому
// заказ создаётся сразу с позициями (Batch + BatchItem), без промежуточного
// шага. Это упрощённая версия: без разбивки по складам, MOQ, веса/объёма
// коробок и доли выкупа WB, которые считает только Планировщик — если это
// нужно, лучше открыть /batches/plan. Здесь цель — быстро оформить то, что
// уже видно на этой вкладке, не переключаясь на другую страницу.
export default function CreateOrderSection({ rows }: { rows: ReorderRow[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.productId,
        {
          selected: false,
          qty: String(r.recommendedOrderQty ?? 0),
          price: r.purchasePriceRub !== null ? String(r.purchasePriceRub) : "",
        },
      ])
    )
  );
  const [batchNumber, setBatchNumber] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setLine(productId: string, patch: Partial<LineState>) {
    setLines((prev) => ({ ...prev, [productId]: { ...prev[productId], ...patch } }));
  }

  const subtotal = useMemo(() => {
    let count = 0;
    let sum = 0;
    for (const r of rows) {
      const line = lines[r.productId];
      const qty = Number(line?.qty) || 0;
      const price = Number(line?.price) || 0;
      if (!line?.selected || qty <= 0) continue;
      count++;
      sum += qty * price;
    }
    return { count, sum: Math.round(sum * 100) / 100 };
  }, [rows, lines]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!batchNumber.trim()) {
      setError("Укажите номер поставки");
      return;
    }

    const items = rows
      .filter((r) => lines[r.productId]?.selected)
      .map((r) => ({
        productId: r.productId,
        qty: Number(lines[r.productId].qty),
        purchasePriceRub: Number(lines[r.productId].price),
      }));

    if (items.length === 0) {
      setError("Выберите хотя бы один товар");
      return;
    }
    const badItem = items.find((i) => !i.qty || i.qty <= 0 || !i.purchasePriceRub || i.purchasePriceRub <= 0);
    if (badItem) {
      setError("У всех выбранных товаров должны быть заполнены количество и цена закупки больше нуля");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/batches/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchNumber, orderDate, items }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Не удалось создать поставку");
      return;
    }

    const body = await res.json();
    router.push(`/batches/${body.id}`);
  }

  if (rows.length === 0) return null;

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 15 }}>Создать заказ по этим товарам</h3>
      <p className="muted">
        Отметьте товары, поправьте при необходимости количество и цену закупки
        — заказ (поставка) создастся сразу с этими позициями. Для разбивки по
        складам, минимальной партии поставщика и расчёта веса/объёма
        коробок — используйте полный <a href="/batches/plan">Планировщик поставок</a>.
      </p>

      <div className="row" style={{ maxWidth: 480, marginBottom: 12 }}>
        <label>
          Номер поставки
          <input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="напр. B-2026-07" />
        </label>
        <label>
          Дата заказа
          <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </label>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              <th style={{ width: 52 }} />
              <th>SKU / Товар</th>
              <th>Остаток</th>
              <th>Продаж/день</th>
              <th>Дней до конца</th>
              <th>Заказать, шт</th>
              <th>Цена закупки, ₽</th>
              <th>Сумма, ₽</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const line = lines[r.productId];
              const qty = Number(line.qty) || 0;
              const price = Number(line.price) || 0;
              return (
                <tr key={r.productId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={line.selected}
                      onChange={(e) => setLine(r.productId, { selected: e.target.checked })}
                    />
                  </td>
                  <td>
                    <PhotoThumb url={r.photoUrl} size={40} />
                  </td>
                  <td>
                    {r.sku}
                    <div className="muted">{r.name}</div>
                  </td>
                  <td>{r.qtyAvailable}</td>
                  <td>{r.avgDailySalesQty || "—"}</td>
                  <td>{r.daysOfStockLeft ?? "—"}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={line.qty}
                      onChange={(e) => setLine(r.productId, { qty: e.target.value })}
                      style={{ width: 90 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.price}
                      onChange={(e) => setLine(r.productId, { price: e.target.value })}
                      style={{ width: 100 }}
                    />
                  </td>
                  <td>{qty && price ? fmt(Math.round(qty * price * 100) / 100) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        className="muted"
        style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span>
          Выбрано товаров: <strong>{subtotal.count}</strong> · сумма партии: <strong>{fmt(subtotal.sum)} ₽</strong>
        </span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="actions" style={{ marginTop: 12 }}>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Создаю поставку…" : "Создать поставку"}
        </button>
      </div>
    </form>
  );
}
