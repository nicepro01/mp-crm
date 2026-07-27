"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type BatchFormValues = {
  id?: string;
  batchNumber: string;
  orderDate: string;
  shipmentDate: string;
  etaDate: string;
  arrivedDate: string;
  logisticsStatus: string;
  notes: string;
};

const emptyValues: BatchFormValues = {
  batchNumber: "",
  orderDate: "",
  shipmentDate: "",
  etaDate: "",
  arrivedDate: "",
  logisticsStatus: "PLANNED",
  notes: "",
};

const logisticsStatusLabels: Record<string, string> = {
  PLANNED: "Запланировано",
  PRODUCTION: "Производство",
  IN_TRANSIT: "В пути",
  CUSTOMS: "Таможня",
  ARRIVED: "Прибыло",
  RECEIVED: "Оприходовано",
};

export default function BatchForm({
  initial,
}: {
  initial?: Partial<BatchFormValues>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<BatchFormValues>({
    ...emptyValues,
    ...initial,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(values.id);

  function set<K extends keyof BatchFormValues>(key: K, value: BatchFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      batchNumber: values.batchNumber,
      orderDate: values.orderDate,
      shipmentDate: values.shipmentDate || null,
      etaDate: values.etaDate || null,
      arrivedDate: values.arrivedDate || null,
      logisticsStatus: values.logisticsStatus,
      notes: values.notes || null,
    };

    const url = isEdit ? `/api/batches/${values.id}` : "/api/batches";
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка сохранения");
      return;
    }

    router.push("/batches");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}

      <label>
        Номер накладной *
        <input
          required
          value={values.batchNumber}
          onChange={(e) => set("batchNumber", e.target.value)}
        />
      </label>
      <div className="muted">
        Поставщик указывается для каждой позиции отдельно — поставка может
        быть консолидированной от нескольких поставщиков.
      </div>

      <div className="row">
        <label>
          Дата заказа *
          <input
            required
            type="date"
            value={values.orderDate}
            onChange={(e) => set("orderDate", e.target.value)}
          />
        </label>
        <label>
          Дата отгрузки
          <input
            type="date"
            value={values.shipmentDate}
            onChange={(e) => set("shipmentDate", e.target.value)}
          />
        </label>
      </div>

      <div className="row">
        <label>
          Дата прибытия (план)
          <input
            type="date"
            value={values.etaDate}
            onChange={(e) => set("etaDate", e.target.value)}
          />
        </label>
        <label>
          Дата прибытия (факт)
          <input
            type="date"
            value={values.arrivedDate}
            onChange={(e) => set("arrivedDate", e.target.value)}
          />
        </label>
      </div>

      <label>
        Статус логистики
        <select
          value={values.logisticsStatus}
          onChange={(e) => set("logisticsStatus", e.target.value)}
        >
          {Object.entries(logisticsStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Заметки
        <textarea
          rows={3}
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </label>

      <div className="actions">
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => router.push("/batches")}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
