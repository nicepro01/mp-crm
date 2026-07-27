"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SupplierFormValues = {
  id?: string;
  name: string;
  contactInfo: string;
  paymentTerms: string;
  moq: string;
  leadTimeDays: string;
  rating: string;
  notes: string;
};

const emptyValues: SupplierFormValues = {
  name: "",
  contactInfo: "",
  paymentTerms: "",
  moq: "",
  leadTimeDays: "",
  rating: "",
  notes: "",
};

export default function SupplierForm({
  initial,
}: {
  initial?: Partial<SupplierFormValues>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<SupplierFormValues>({
    ...emptyValues,
    ...initial,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(values.id);

  function set<K extends keyof SupplierFormValues>(
    key: K,
    value: SupplierFormValues[K]
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: values.name,
      contactInfo: values.contactInfo || null,
      paymentTerms: values.paymentTerms || null,
      moq: values.moq,
      leadTimeDays: values.leadTimeDays,
      rating: values.rating,
      notes: values.notes || null,
    };

    const url = isEdit ? `/api/suppliers/${values.id}` : "/api/suppliers";
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

    router.push("/suppliers");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}

      <label>
        Название *
        <input
          required
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </label>

      <label>
        Контакты
        <input
          value={values.contactInfo}
          onChange={(e) => set("contactInfo", e.target.value)}
          placeholder="WeChat, телефон, email…"
        />
      </label>

      <label>
        Условия оплаты
        <input
          value={values.paymentTerms}
          onChange={(e) => set("paymentTerms", e.target.value)}
          placeholder="напр. 30% аванс, 70% перед отгрузкой"
        />
      </label>

      <div className="row">
        <label>
          MOQ (мин. партия)
          <input
            type="number"
            value={values.moq}
            onChange={(e) => set("moq", e.target.value)}
          />
        </label>
        <label>
          Срок изготовления, дн.
          <input
            type="number"
            value={values.leadTimeDays}
            onChange={(e) => set("leadTimeDays", e.target.value)}
          />
        </label>
      </div>

      <label>
        Рейтинг (1-5)
        <input
          type="number"
          min={1}
          max={5}
          value={values.rating}
          onChange={(e) => set("rating", e.target.value)}
        />
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
          onClick={() => router.push("/suppliers")}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
