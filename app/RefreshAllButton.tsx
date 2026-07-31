"use client";

import { useState } from "react";

const ENDPOINTS: { key: string; label: string; path: string }[] = [
  { key: "wb", label: "WB", path: "/api/daily-sync/wb" },
  { key: "ozon", label: "Ozon", path: "/api/daily-sync/ozon" },
  { key: "yandex", label: "Яндекс.Маркет", path: "/api/daily-sync/yandex" },
];

type MarketplaceOutcome = { label: string; ok: boolean; detail: string };

// Одна кнопка вместо десятка разбросанных по разным страницам — обновляет
// АБСОЛЮТНО всё (юнит-экономика, графики заказов, сезонность, остатки,
// возвраты) сразу по всем 3 площадкам. То же самое (плюс по расписанию, для
// всех компаний) происходит автоматически каждую ночь через Vercel Cron —
// см. vercel.json + app/api/cron/{wb,ozon,yandex}/route.ts. Три площадки
// идут ПАРАЛЛЕЛЬНО (тот же приём, что и в AllMarketplacesSyncForm.tsx) —
// общее время ожидания = самая долгая из трёх (обычно Яндекс, ~2-3 минуты
// из-за собственного жёсткого рейт-лимита площадки), а не сумма всех трёх.
export default function RefreshAllButton() {
  const [syncing, setSyncing] = useState(false);
  const [results, setResults] = useState<MarketplaceOutcome[] | null>(null);

  async function handleClick() {
    setSyncing(true);
    setResults(null);

    const settled = await Promise.all(
      ENDPOINTS.map(async ({ label, path }): Promise<MarketplaceOutcome> => {
        try {
          const res = await fetch(path, { method: "POST" });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            return { label, ok: false, detail: body.error ?? "Ошибка запроса" };
          }
          // Тело — {[marketplaceId]: {name, results: {[subSync]: {ok, error?}}}}
          // (несколько строк на код возможны — напр. два магазина Ozon).
          const perMarketplace = body as Record<string, { name: string; results: Record<string, { ok: boolean; error?: string }> }>;
          const failed = Object.values(perMarketplace).flatMap(({ name, results }) =>
            Object.entries(results)
              .filter(([, v]) => v && v.ok === false)
              .map(([k, v]) => `${name}/${k}: ${v.error}`)
          );
          return {
            label,
            ok: failed.length === 0,
            detail: failed.length === 0 ? "готово" : failed.join("; "),
          };
        } catch (err: any) {
          return { label, ok: false, detail: err.message ?? "Не удалось выполнить запрос" };
        }
      })
    );

    setSyncing(false);
    setResults(settled);
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className={`nav-icon-btn${syncing ? " spinning" : ""}`}
        onClick={handleClick}
        disabled={syncing}
        title="Обновить всё (WB + Ozon + Яндекс.Маркет)"
      >
        🔄
      </button>
      {results && (
        <div
          className="muted"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "10px 12px",
            minWidth: 260,
            fontSize: 13,
            zIndex: 200,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}
        >
          {results.map((r) => (
            <div key={r.label} style={{ marginBottom: 4 }}>
              <strong style={{ color: "var(--fg)" }}>{r.label}:</strong>{" "}
              <span className={r.ok ? "margin-positive" : "error"}>{r.detail}</span>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: 6, fontSize: 12, padding: "4px 8px" }}
            onClick={() => setResults(null)}
          >
            Закрыть
          </button>
        </div>
      )}
    </div>
  );
}
