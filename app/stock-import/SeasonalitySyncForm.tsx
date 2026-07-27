"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SyncSummary = {
  salesFetched: number;
  matched: number;
  unmatched: number;
  monthsUpserted: number;
};

export default function SeasonalitySyncForm({
  endpoint,
  label,
  description,
}: {
  endpoint: string;
  label: string;
  description: React.ReactNode;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncSummary | null>(null);

  async function handleSync() {
    setError(null);
    setResult(null);
    setSyncing(true);

    const res = await fetch(endpoint, { method: "POST" });
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

  return (
    <div style={{ maxWidth: 640, marginBottom: 24 }}>
      <div style={{ marginBottom: 8 }}>{description}</div>
      <button type="button" className="btn" onClick={handleSync} disabled={syncing}>
        {syncing ? "Синхронизация…" : label}
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
