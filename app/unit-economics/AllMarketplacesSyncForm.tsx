"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type MarketplaceResult = {
  label: string;
  total: number;
  updated: number;
  noSales: number;
  notFound: number;
  notFoundCodes: string[];
} | { label: string; error: string };

const SYNC_ENDPOINTS: { key: string; label: string; path: string }[] = [
  { key: "wb", label: "WB", path: "/api/unit-economics/sync-wb" },
  { key: "ozon", label: "Ozon", path: "/api/unit-economics/sync-ozon" },
  { key: "yandex", label: "Яндекс.Маркет", path: "/api/unit-economics/sync-yandex" },
];

// Три независимых внешних API (WB/Ozon/Яндекс) — рейт-лимиты у каждого свои
// и друг с другом не пересекаются, поэтому синки безопасно идут параллельно:
// общее время = самый долгий из трёх (сейчас это Яндекс, ~2-3 минуты из-за
// его собственных пауз между отчётами), а не сумма всех трёх по очереди.
export default function AllMarketplacesSyncForm() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [results, setResults] = useState<MarketplaceResult[] | null>(null);

  async function handleSync() {
    setResults(null);
    setSyncing(true);

    const settled = await Promise.all(
      SYNC_ENDPOINTS.map(async ({ label, path }) => {
        try {
          const res = await fetch(path, { method: "POST" });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            return { label, error: body.error ?? "Ошибка синхронизации" };
          }
          return {
            label,
            total: body.total ?? 0,
            updated: body.updated ?? 0,
            noSales: body.noSales ?? 0,
            notFound: body.notFound ?? 0,
            notFoundCodes: body.notFoundSkus ?? body.notFoundNmIds ?? [],
          };
        } catch (err: any) {
          return { label, error: err.message ?? "Не удалось выполнить запрос" };
        }
      })
    );

    setSyncing(false);
    setResults(settled);
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 720, marginBottom: 24 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Реальная юнит-экономика</strong> — фактические выплаты,
        комиссия, логистика, хранение, реклама и % выкупа сразу по всем трём
        площадкам, из их отчётов (вместо ручного расчёта).
      </div>
      <button type="button" className="btn" onClick={handleSync} disabled={syncing}>
        {syncing ? "Синхронизация… (до 2-3 минут)" : "Обновить WB + Ozon + Яндекс.Маркет"}
      </button>

      {results && (
        <div
          className="muted"
          style={{ background: "var(--surface-alt)", padding: "10px 12px", borderRadius: 6, marginTop: 12 }}
        >
          {results.map((r) => (
            <div key={r.label} style={{ marginBottom: 6 }}>
              <strong>{r.label}:</strong>{" "}
              {"error" in r ? (
                <span className="error">{r.error}</span>
              ) : (
                <>
                  товаров с операциями: {r.total} · обновлено: {r.updated}
                  {r.noSales > 0 && <> · без продаж: {r.noSales}</>}
                  {r.notFound > 0 && <> · не нашли товар ({r.notFound}): {r.notFoundCodes.join(", ")}</>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
