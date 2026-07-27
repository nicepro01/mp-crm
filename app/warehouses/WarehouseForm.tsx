"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Marketplace = { id: string; name: string };

const typeLabels: Record<string, string> = {
  OWN_B2B: "Свой склад (B2B)",
  MARKETPLACE_FBO: "FBO маркетплейса",
  MARKETPLACE_FBS: "FBS маркетплейса",
};

type FormValues = {
  id?: string;
  name: string;
  type: string;
  marketplaceId: string;
};

export default function WarehouseForm({
  marketplaces,
  initial,
}: {
  marketplaces: Marketplace[];
  initial?: Partial<FormValues>;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState(initial?.type ?? "OWN_B2B");
  const [marketplaceId, setMarketplaceId] = useState(initial?.marketplaceId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(initial?.id);
  const needsMarketplace = type !== "OWN_B2B";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = isEdit ? `/api/warehouses/${initial!.id}` : "/api/warehouses";
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        type,
        marketplaceId: needsMarketplace ? marketplaceId : null,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка сохранения");
      return;
    }

    router.push("/warehouses");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}

      <label>
        Тип склада *
        <select required value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(typeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {needsMarketplace && (
        <label>
          Площадка *
          <select
            required
            value={marketplaceId}
            onChange={(e) => setMarketplaceId(e.target.value)}
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
      )}

      <label>
        Название *
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="actions">
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => router.push("/warehouses")}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
