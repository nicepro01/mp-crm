"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SyncSummary = {
  total: number;
  updated: number;
  pending: number;
  skipped: number;
  pendingCodes: string[];
};

export default function YandexApiSyncForm() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncSummary | null>(null);

  async function handleSync() {
    setError(null);
    setResult(null);
    setSyncing(true);

    const res = await fetch("/api/stock-import/yandex-sync", { method: "POST" });
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
      <div style={{ marginBottom: 8 }}>
        <strong>Синхронизация через Yandex Market API</strong> — остатки FBO
        и FBS сразу по обоим складам, без ручной загрузки файла.
      </div>
      <button type="button" className="btn" onClick={handleSync} disabled={syncing}>
        {syncing ? "Синхронизация…" : "Обновить из Yandex Market API"}
      </button>
      {error && <div className="error">{error}</div>}

      {result && (
        <div
          className="muted"
          style={{ background: "var(--surface-alt)", padding: "10px 12px", borderRadius: 6, marginTop: 12 }}
        >
          Обработано артикулов: {result.total} · обновлён остаток: {result.updated}
          {result.skipped > 0 && <> · пропущено: {result.skipped}</>}
          {" · "}ждут сопоставления: <strong>{result.pending}</strong>
          {result.pending > 0 && (
            <div style={{ marginTop: 8 }}>
              Несопоставленные артикулы: {result.pendingCodes.join(", ")}
              <br />
              Перейдите на <a href="/matching">страницу «Сопоставление»</a> и привяжите
              их к товарам.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
