"use client";

import { useState } from "react";
import { MiniBarChart, ChartBar } from "./MiniChart";

export type SingleMetricScope = {
  code: string;
  label: string;
  data: ChartBar[];
  // Легенда площадок — только у сводного вида ("Все площадки"), где столбики
  // составные; та же логика, что и у RevenueChartWidget.
  legend?: { code: string; label: string; color: string }[];
};

// Тот же переключатель площадки, что и в RevenueChartWidget/TopMoversWidget/
// AttentionWidget, но для одного-единственного графика (не пары рядом) — так
// проще переиспользовать для любой новой метрики по месяцам без раздувания
// самого RevenueChartWidget под каждый новый случай.
export default function SingleMetricChartWidget({
  scopes,
  color,
  valueSuffix = "",
}: {
  scopes: SingleMetricScope[];
  color: string;
  valueSuffix?: string;
}) {
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
      <MiniBarChart data={active.data} color={color} valueSuffix={valueSuffix} />
    </div>
  );
}
