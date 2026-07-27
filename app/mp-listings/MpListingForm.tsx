"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Product = { id: string; sku: string; name: string };
type Marketplace = { id: string; code: string; name: string };

type FormValues = {
  id?: string;
  productId: string;
  marketplaceId: string;
  mpSku: string;
  mpProductId: string;
  commissionPct: string;
  logisticsFeeRub: string;
  storageFeeRub: string;
  currentPrice: string;
  isActive: boolean;
};

const emptyValues: FormValues = {
  productId: "",
  marketplaceId: "",
  mpSku: "",
  mpProductId: "",
  commissionPct: "",
  logisticsFeeRub: "",
  storageFeeRub: "",
  currentPrice: "",
  isActive: true,
};

export default function MpListingForm({
  products,
  marketplaces,
  initial,
}: {
  products: Product[];
  marketplaces: Marketplace[];
  initial?: Partial<FormValues>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    ...emptyValues,
    ...initial,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(values.id);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      productId: values.productId,
      marketplaceId: values.marketplaceId,
      mpSku: values.mpSku,
      mpProductId: values.mpProductId || null,
      commissionPct: values.commissionPct,
      logisticsFeeRub: values.logisticsFeeRub || null,
      storageFeeRub: values.storageFeeRub || null,
      currentPrice: values.currentPrice || null,
      isActive: values.isActive,
    };

    const url = isEdit ? `/api/mp-listings/${values.id}` : "/api/mp-listings";
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

    router.push("/mp-listings");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}

      <div className="row">
        <label>
          Товар *
          <select
            required
            value={values.productId}
            onChange={(e) => set("productId", e.target.value)}
          >
            <option value="" disabled>
              Выберите товар
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Площадка *
          <select
            required
            value={values.marketplaceId}
            onChange={(e) => set("marketplaceId", e.target.value)}
          >
            <option value="" disabled>
              Выберите площадку
            </option>
            {marketplaces.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row">
        <label>
          Артикул на площадке (SKU/nmID) *
          <input
            required
            value={values.mpSku}
            onChange={(e) => set("mpSku", e.target.value)}
          />
        </label>
        <label>
          Внутренний ID МП
          <input
            value={values.mpProductId}
            onChange={(e) => set("mpProductId", e.target.value)}
          />
        </label>
      </div>

      <div className="row">
        <label>
          Комиссия МП, % *
          <input
            required
            type="number"
            step="0.01"
            value={values.commissionPct}
            onChange={(e) => set("commissionPct", e.target.value)}
          />
        </label>
        <label>
          Логистика МП, ₽/шт
          <input
            type="number"
            step="0.01"
            value={values.logisticsFeeRub}
            onChange={(e) => set("logisticsFeeRub", e.target.value)}
          />
        </label>
      </div>

      <div className="row">
        <label>
          Хранение, ₽/шт
          <input
            type="number"
            step="0.01"
            value={values.storageFeeRub}
            onChange={(e) => set("storageFeeRub", e.target.value)}
          />
        </label>
        <label>
          Текущая цена, ₽
          <input
            type="number"
            step="0.01"
            value={values.currentPrice}
            onChange={(e) => set("currentPrice", e.target.value)}
          />
        </label>
      </div>

      <label>
        Активен
        <select
          value={values.isActive ? "yes" : "no"}
          onChange={(e) => set("isActive", e.target.value === "yes")}
        >
          <option value="yes">Да</option>
          <option value="no">Нет</option>
        </select>
      </label>

      <div className="actions">
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => router.push("/mp-listings")}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
