"use client";

import { useState } from "react";

// Ozon разбит на 4 отдельных вызова (юнит-экономика/график/сезонность/
// остатки) — с реальными данными общий вызов на всё сразу упирался в лимит
// времени Vercel Hobby (300с), даже когда магазины одной площадки уже шли
// параллельно друг другу (см. lib/dailySync.ts). WB/Яндекс пока укладываются
// в лимит одним вызовом, поэтому не разбиты. В попапе несколько эндпоинтов с
// одинаковым label схлопываются в одну строку (см. handleClick).
const ENDPOINTS: { key: string; label: string; path: string }[] = [
  { key: "wb", label: "WB", path: "/api/daily-sync/wb" },
  { key: "ozon-unit-economics", label: "Ozon", path: "/api/daily-sync/ozon-unit-economics" },
  { key: "ozon-funnel", label: "Ozon", path: "/api/daily-sync/ozon-funnel" },
  { key: "ozon-seasonality", label: "Ozon", path: "/api/daily-sync/ozon-seasonality" },
  { key: "ozon-stock-import", label: "Ozon", path: "/api/daily-sync/ozon-stock-import" },
  { key: "yandex", label: "Яндекс.Маркет", path: "/api/daily-sync/yandex" },
];

type MarketplaceOutcome = { label: string; ok: boolean; detail: string };

// Одна кнопка вместо десятка разбросанных по разным страницам — обновляет
// АБСОЛЮТНО всё (юнит-экономика, графики заказов, сезонность, остатки,
// возвраты) сразу по всем 3 площадкам. То же самое (плюс по расписанию, для
// всех компаний) происходит автоматически каждую ночь через Vercel Cron —
// см. vercel.json + app/api/cron/*/route.ts. Все эндпоинты идут ПАРАЛЛЕЛЬНО
// (тот же приём, что и в AllMarketplacesSyncForm.tsx) — общее время ожидания
// = самый долгий из них, а не сумма всех.
export default function RefreshAllButton() {
  const [syncing, setSyncing] = useState(false);
  const [results, setResults] = useState<MarketplaceOutcome[] | null>(null);

  async function handleClick() {
    setSyncing(true);
    setResults(null);

    const perEndpoint = await Promise.all(
      ENDPOINTS.map(async ({ label, path }) => {
        try {
          const res = await fetch(path, { method: "POST" });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            return { label, failed: [body.error ?? "Ошибка запроса"] };
          }
          // Тело — {[marketplaceId]: {name, results: {[subSync]: {ok, error?}}}}
          // (несколько строк на код возможны — напр. два магазина Ozon).
          const perMarketplace = body as Record<string, { name: string; results: Record<string, { ok: boolean; error?: string }> }>;
          const failed = Object.values(perMarketplace).flatMap(({ name, results }) =>
            Object.entries(results)
              .filter(([, v]) => v && v.ok === false)
              .map(([k, v]) => `${name}/${k}: ${v.error}`)
          );
          return { label, failed };
        } catch (err: any) {
          return { label, failed: [err.message ?? "Не удалось выполнить запрос"] };
        }
      })
    );

    // Схлопываем несколько эндпоинтов одной площадки (Ozon) в одну строку.
    const failedByLabel = new Map<string, string[]>();
    for (const { label, failed } of perEndpoint) {
      const list = failedByLabel.get(label) ?? [];
      list.push(...failed);
      failedByLabel.set(label, list);
    }
    const settled: MarketplaceOutcome[] = [...failedByLabel.entries()].map(([label, failed]) => ({
      label,
      ok: failed.length === 0,
      detail: failed.length === 0 ? "готово" : failed.join("; "),
    }));

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
