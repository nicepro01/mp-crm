"use client";

import { useState } from "react";
import { MiniBarChart, ChartBar } from "./MiniChart";

export type ChartScope = {
  code: string;
  label: string;
  revenue: ChartBar[];
  qty: ChartBar[];
  // Легенда площадок — только у сводного вида ("Все площадки"), где столбики
  // составные; у отдельной площадки легенда не нужна (один цвет и так ясен).
  legend?: { code: string; label: string; color: string }[];
};

// Переключатель площадки для графиков "Выручка"/"Продано, шт" на дашборде —
// та же площадка, что и в разделах ниже; "Все площадки" — вид по умолчанию,
// там столбики составные (видна доля каждой площадки внутри месяца).
export default function RevenueChartWidget({ scopes }: { scopes: ChartScope[] }) {
  const [activeCode, setActiveCode] = useState(scopes[0]?.code ?? "");
  const active = scopes.find((s) => s.code === activeCode) ?? scopes[0];
  if (!active) return null;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {scopes.map((s) => (
          <button
            key={s.code}
            type="button"
            className={s.code === activeCode ? "btn" : "btn btn-secondary"}
            onClick={() => setActiveCode(s.code)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {active.legend && active.legend.length > 0 && (
        <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
          {active.legend.map((l) => (
            <div key={l.code} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }} className="muted">
              <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color, display: "inline-block" }} />
              {l.label}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
        <div style={{ minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
            Выручка, ₽
          </div>
          <MiniBarChart data={active.revenue} color="#2563eb" valueSuffix="₽" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
            Продано, шт
          </div>
          <MiniBarChart data={active.qty} color="#f97316" valueSuffix="шт" />
        </div>
      </div>
    </div>
  );
}
