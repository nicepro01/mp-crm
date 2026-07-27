"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SyncSummary = { total: number; updated: number; matched: number; unmatched: number };

export default function ReturnsSyncForm() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncSummary | null>(null);

  async function handleSync() {
    setError(null);
    setResult(null);
    setSyncing(true);

    const res = await fetch("/api/returns/sync-wb", { method: "POST" });
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
      <button type="button" className="btn" onClick={handleSync} disabled={syncing}>
        {syncing ? "Синхронизация…" : "Обновить из WB API"}
      </button>
      {error && <div className="error">{error}</div>}

      {result && (
        <div
          className="muted"
          style={{ background: "var(--surface-alt)", padding: "10px 12px", borderRadius: 6, marginTop: 12 }}
        >
          Заявок обработано: {result.total} · сопоставлено с товаром: {result.matched}
          {result.unmatched > 0 && <> · без товара: {result.unmatched}</>}
        </div>
      )}
    </div>
  );
}
