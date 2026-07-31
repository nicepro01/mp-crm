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
  // Раньше код, уже занятый другой площадкой, исключался из списка — теперь
  // у компании может быть несколько магазинов одной площадки (напр. два
  // Ozon), поэтому выбрать можно любой код; отличаются они только полем
  // "Название" (уникальным в пределах компании).
  const availableCodes = Object.keys(codeLabels);
  const codeUsedCount = (c: string) => usedCodes.filter((used) => used === c).length;

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
            if (!name) {
              const baseLabel = codeLabels[e.target.value] ?? "";
              const usedCount = codeUsedCount(e.target.value);
              // Код уже занят другим магазином (напр. уже есть "Ozon") —
              // подставляем "Ozon 2" вместо простого повтора названия,
              // пользователь может поправить как угодно.
              setName(usedCount > 0 ? `${baseLabel} ${usedCount + 1}` : baseLabel);
            }
          }}
        >
          <option value="" disabled>
            Выберите площадку
          </option>
          {availableCodes.map((c) => {
            const usedCount = codeUsedCount(c);
            return (
              <option key={c} value={c}>
                {codeLabels[c]}
                {usedCount > 0 ? ` (уже подключено: ${usedCount})` : ""}
              </option>
            );
          })}
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
