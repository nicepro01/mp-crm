"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SyncSummary = {
  salesFetched: number;
  matched: number;
  unmatched: number;
  monthsUpserted: number;
};

// Отдельная форма (не переиспользует SeasonalitySyncForm) — тут нужен
// параметр "сколько месяцев вглубь" и предупреждение о реальной
// длительности (рейт-лимит Яндекса не позволяет ускорить это одним запросом).
export default function YandexBackfillForm() {
  const router = useRouter();
  const [monthsBack, setMonthsBack] = useState(3);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncSummary | null>(null);

  async function handleSync() {
    setError(null);
    setResult(null);
    setSyncing(true);

    const res = await fetch("/api/seasonality/sync-yandex-backfill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthsBack }),
    });
    setSyncing(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка синхронизации");
      return;
    }

    const body: SyncSummary = await res.json();
    setResult(body);
    router.refresh();
  }

  const estimatedMinutes = Math.round(monthsBack * 4.3);

  return (
    <div style={{ maxWidth: 640, marginBottom: 24 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Бэкфилл более глубокой истории Яндекс.Маркета</strong> —
        отчёт «Реализация товаров» за конкретные прошедшие месяцы. В отличие
        от «Аналитики продаж» выше НЕ ограничен 90 днями (проверено: данные
        за декабрь 2025 доступны и сейчас). Пишет в ту же историю продаж, что
        используется в Планировщике поставок, экспорте на склад и Аналитике —
        не только здесь. Рейт-лимит Яндекса — 1 запрос в 2 минуты на весь
        аккаунт, поэтому за один месяц уходит ~4 минуты; кнопка будет
        недоступна, пока идёт синхронизация. При большом числе месяцев лучше
        запускать частями (например, по 3) и не закрывать вкладку до конца.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <label className="muted" style={{ fontSize: 13 }}>
          Сколько месяцев вглубь:
          <input
            type="number"
            min={1}
            max={12}
            value={monthsBack}
            onChange={(e) => setMonthsBack(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
            disabled={syncing}
            style={{ width: 56, marginLeft: 8 }}
          />
        </label>
        <span className="muted" style={{ fontSize: 13 }}>
          ~{estimatedMinutes} мин
        </span>
      </div>
      <button type="button" className="btn" onClick={handleSync} disabled={syncing}>
        {syncing ? `Синхронизация… (~${estimatedMinutes} мин, не закрывайте вкладку)` : "Запустить бэкфилл"}
      </button>
      {error && <div className="error">{error}</div>}

      {result && (
        <div
          className="muted"
          style={{ background: "var(--surface-alt)", padding: "10px 12px", borderRadius: 6, marginTop: 12 }}
        >
          Загружено продаж: {result.salesFetched} · сопоставлено с товарами:{" "}
          {result.matched}
          {result.unmatched > 0 && <> · не сопоставлено: {result.unmatched}</>}
          {" · "}обновлено месяцев в истории: <strong>{result.monthsUpserted}</strong>
        </div>
      )}
    </div>
  );
}
