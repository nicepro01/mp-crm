"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Marketplace = { id: string; name: string };

type ImportSummary = {
  total: number;
  matchedListing: number;
  matchedBarcode: number;
  pending: number;
  skipped: number;
};

export default function MatchingImportForm({
  marketplaces,
}: {
  marketplaces: Marketplace[];
}) {
  const router = useRouter();
  const [marketplaceId, setMarketplaceId] = useState("");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [loading, setLoading] = useState(false);

  function parseLines(text: string) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [mpSku, barcode, ...rest] = line.split(",").map((s) => s.trim());
        return {
          mpSku,
          barcode: barcode || null,
          name: rest.length > 0 ? rest.join(",").trim() : null,
        };
      });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!marketplaceId) {
      setError("Выберите площадку");
      return;
    }
    const items = parseLines(raw);
    if (items.length === 0) {
      setError("Вставьте хотя бы одну строку");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/matching/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketplaceId, items }),
    });
    setLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка импорта");
      return;
    }

    const body: ImportSummary = await res.json();
    setResult(body);
    setRaw("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 640, marginBottom: 32 }}>
      <div className="muted">
        Тестовый импорт — имитация ответа API площадки, чтобы проверить логику
        сопоставления до подключения реальных ключей (Шаг 3). Формат: одна
        строка на товар — <code>артикул_площадки, штрихкод, название</code>{" "}
        (штрихкод и название необязательны).
      </div>

      {error && <div className="error">{error}</div>}

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

      <label>
        Список товаров с площадки
        <textarea
          rows={6}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={
            "WB-1001,4601234567890,Наушники беспроводные чёрные\nWB-1002,,Наушники беспроводные белые\nWB-1003,4601234567891"
          }
        />
      </label>

      <div className="actions">
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Импортирую…" : "Импортировать"}
        </button>
      </div>

      {result && (
        <div
          className="muted"
          style={{ background: "var(--surface-alt)", padding: "10px 12px", borderRadius: 6 }}
        >
          Обработано: {result.total} · по листингу: {result.matchedListing} · по
          штрихкоду: {result.matchedBarcode} · ждут ручного сопоставления:{" "}
          <strong>{result.pending}</strong>
          {result.skipped > 0 && <> · пропущено (уже решены ранее): {result.skipped}</>}
        </div>
      )}
    </form>
  );
}
