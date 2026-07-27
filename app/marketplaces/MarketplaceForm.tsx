"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const codeLabels: Record<string, string> = {
  WB: "Wildberries",
  OZON: "Ozon",
  YANDEX_MARKET: "Яндекс.Маркет",
};

type FormValues = {
  id?: string;
  code: string;
  name: string;
};

export default function MarketplaceForm({
  initial,
  usedCodes,
}: {
  initial?: Partial<FormValues>;
  usedCodes: string[];
}) {
  const router = useRouter();
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(initial?.id);
  const availableCodes = Object.keys(codeLabels).filter(
    (c) => c === initial?.code || !usedCodes.includes(c)
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = isEdit ? `/api/marketplaces/${initial!.id}` : "/api/marketplaces";
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка сохранения");
      return;
    }

    router.push("/marketplaces");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}

      <label>
        Площадка *
        <select
          required
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (!name) setName(codeLabels[e.target.value] ?? "");
          }}
        >
          <option value="" disabled>
            Выберите площадку
          </option>
          {availableCodes.map((c) => (
            <option key={c} value={c}>
              {codeLabels[c]}
            </option>
          ))}
        </select>
      </label>

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
          onClick={() => router.push("/marketplaces")}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
