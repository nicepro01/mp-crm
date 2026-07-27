"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type MarketplaceRow = {
  id: string;
  code: string;
  name: string;
  credentials: Record<string, string>;
};

const CODE_LABELS: Record<string, string> = {
  WB: "Wildberries",
  OZON: "Ozon",
  YANDEX_MARKET: "Яндекс.Маркет",
};

// Поля зависят от площадки — у каждой свой набор учётных данных API.
const FIELDS_BY_CODE: Record<string, { key: string; label: string; type?: string }[]> = {
  WB: [{ key: "token", label: "API-токен (категории Аналитика, Контент, Статистика, Продвижение, Возвраты)", type: "password" }],
  OZON: [
    { key: "clientId", label: "Client-Id" },
    { key: "apiKey", label: "Api-Key", type: "password" },
  ],
  YANDEX_MARKET: [
    { key: "token", label: "API-токен", type: "password" },
    { key: "businessId", label: "Business ID" },
    { key: "fbyCampaignId", label: "Campaign ID склада FBY (Я.Маркет FBO)" },
    { key: "fbsCampaignId", label: "Campaign ID склада FBS" },
  ],
};

function IntegrationCard({ row }: { row: MarketplaceRow }) {
  const router = useRouter();
  const fields = FIELDS_BY_CODE[row.code] ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, row.credentials[f.key] ?? ""]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const res = await fetch(`/api/marketplaces/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials: values }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Не удалось сохранить");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: 16, marginBottom: 4 }}>{CODE_LABELS[row.code] ?? row.name}</h3>
      {fields.map((f) => (
        <label key={f.key}>
          {f.label}
          <input
            type={f.type ?? "text"}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        </label>
      ))}
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
        {saved && <span className="muted">Сохранено</span>}
      </div>
    </form>
  );
}

export default function IntegrationsForm({ rows }: { rows: MarketplaceRow[] }) {
  return (
    <div>
      {rows.map((row) => (
        <IntegrationCard key={row.id} row={row} />
      ))}
    </div>
  );
}
