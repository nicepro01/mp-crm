"use client";

import { useEffect, useState } from "react";
import { MiniBarChart, ChartBar } from "./MiniChart";

const RANGE_OPTIONS = [
  { key: "7", label: "7 дней" },
  { key: "14", label: "14 дней" },
  { key: "30", label: "30 дней" },
  { key: "90", label: "90 дней" },
  { key: "monthly", label: "По месяцам" },
];

// Один POST на площадку — у Яндекса это бэкфилл на 1 последний завершённый
// месяц (дневной синхронизации для него не существует, см. лимитацию ниже).
const SYNC_CONFIG: Record<string, { path: string; body?: Record<string, unknown> }> = {
  WB: { path: "/api/marketplace-funnel/sync-wb" },
  OZON: { path: "/api/marketplace-funnel/sync-ozon" },
  YANDEX_MARKET: { path: "/api/marketplace-funnel/sync-yandex-backfill", body: { monthsBack: 1 } },
};

// Честные ограничения по каждой площадке — см. Контекст в плане, не прячем.
const LIMITATION_TEXT: Record<string, string> = {
  WB: "История ограничена ~30 днями — реальный API Wildberries не отдаёт заказы старше месяца. Данные копятся вперёд по мере регулярных синков: чем чаще нажимаете «Обновить», тем длиннее становится история. Последние ~10 дней помечены звёздочкой (*) — исход заказа (выкуп/отказ) там ещё не наступил.",
  OZON: "Функция новая и не проверена на реальном аккаунте — из среды разработки нет доступа к API Ozon. После первого реального синка возможны неточности в цифрах, сообщите, если график выглядит неправдоподобно.",
  YANDEX_MARKET: "Только помесячные данные — у отчёта «Реализация товаров» нет дневной детализации. При выборе 7/14/30/90 дней график для Яндекса будет пустым — переключитесь на «По месяцам».",
};

const LEGEND = [
  { code: "boughtOut", label: "Выкуплено", color: "#16a34a" },
  { code: "cancelled", label: "Отменено", color: "#dc2626" },
  { code: "pending", label: "Ещё не решено", color: "#9ca3af" },
];

type SeriesRow = {
  periodStart: string;
  orderedQty: number;
  boughtOutQty: number;
  cancelledQty: number;
  isProvisional: boolean;
};
type SeriesResponse = {
  granularity: "DAY" | "MONTH";
  requestedRange: string | number;
  availableDays: number;
  rows: SeriesRow[];
};

function formatLabel(periodStart: string, granularity: "DAY" | "MONTH"): string {
  const d = new Date(periodStart);
  if (granularity === "MONTH") {
    return d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

export default function FunnelChartWidget({ code, marketplaceName }: { code: string; marketplaceName: string }) {
  const [range, setRange] = useState("30");
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function loadSeries(r: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/marketplace-funnel/series?code=${code}&range=${r}`);
      const body = await res.json();
      setData(body);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSeries(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    const cfg = SYNC_CONFIG[code];
    try {
      const res = await fetch(cfg.path, {
        method: "POST",
        headers: cfg.body ? { "Content-Type": "application/json" } : undefined,
        body: cfg.body ? JSON.stringify(cfg.body) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncError(body.error ?? "Не удалось синхронизировать");
      } else {
        await loadSeries(range);
      }
    } catch (err: any) {
      setSyncError(err.message ?? "Не удалось выполнить запрос");
    } finally {
      setSyncing(false);
    }
  }

  const granularity = data?.granularity ?? "DAY";
  const chartBars: ChartBar[] = (data?.rows ?? []).map((r) => ({
    label: formatLabel(r.periodStart, granularity) + (r.isProvisional ? " *" : ""),
    value: r.orderedQty,
    segments: [
      { code: "boughtOut", label: "Выкуплено", value: r.boughtOutQty, color: "#16a34a" },
      { code: "cancelled", label: "Отменено", value: r.cancelledQty, color: "#dc2626" },
      {
        code: "pending",
        label: "Ещё не решено",
        value: Math.max(0, r.orderedQty - r.boughtOutQty - r.cancelledQty),
        color: "#9ca3af",
      },
    ],
  }));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={opt.key === range ? "btn" : "btn btn-secondary"}
            onClick={() => setRange(opt.key)}
          >
            {opt.label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleSync}
          disabled={syncing}
          style={{ marginLeft: "auto" }}
        >
          {syncing ? "Синхронизация…" : `Обновить ${marketplaceName}`}
        </button>
      </div>

      {syncError && <p className="error">{syncError}</p>}

      <p className="muted" style={{ marginBottom: 16 }}>
        {LIMITATION_TEXT[code]}
      </p>

      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : chartBars.length === 0 ? (
        <p className="muted">Пока нет данных — нажмите «Обновить {marketplaceName}».</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
            {LEGEND.map((l) => (
              <div key={l.code} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }} className="muted">
                <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color, display: "inline-block" }} />
                {l.label}
              </div>
            ))}
          </div>
          <MiniBarChart data={chartBars} color="#374151" valueSuffix="шт" />
          {typeof data?.requestedRange === "number" && data.availableDays < data.requestedRange && (
            <p className="muted" style={{ marginTop: 8 }}>
              Показано {data.availableDays} из {data.requestedRange} запрошенных дней — история ещё не накопилась.
            </p>
          )}
        </>
      )}
    </div>
  );
}
