"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

export default function OrderForm() {
  const router = useRouter();
  const [channel, setChannel] = useState("B2B");
  const [externalId, setExternalId] = useState("");
  const [orderDate, setOrderDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [status, setStatus] = useState("NEW");
  const [customerName, setCustomerName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        externalId: externalId || null,
        orderDate,
        status,
        customerName: customerName || null,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка сохранения");
      return;
    }

    const order = await res.json();
    router.push(`/orders/${order.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}

      <div className="row">
        <label>
          Канал *
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {Object.entries(channelLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Дата заказа *
          <input
            required
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
          />
        </label>
      </div>

      <div className="row">
        <label>
          Статус
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Внешний ID (заказ на МП)
          <input
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
          />
        </label>
      </div>

      <label>
        Покупатель
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
        />
      </label>

      <div className="actions">
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Сохранение…" : "Создать заказ"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => router.push("/orders")}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
