"use client";

import { useState } from "react";
import PhotoThumb from "@/app/products/PhotoThumb";

export type MoverRow = { id: string; sku: string; name: string; photoUrl: string | null; trendPct: number };
export type MoverScope = { code: string; label: string; growth: MoverRow[]; decline: MoverRow[] };

function MoverList({ rows, color, sign }: { rows: MoverRow[]; color: string; sign: string }) {
  if (rows.length === 0) return <p className="muted">Нет данных.</p>;
  return (
    <table style={{ width: "100%", tableLayout: "fixed" }}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td style={{ width: 48 }}>
              <PhotoThumb url={r.photoUrl} size={40} />
            </td>
            <td style={{ overflow: "hidden" }}>
              {r.sku}
              <div
                className="muted"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  overflowWrap: "break-word",
                }}
              >
                {r.name}
              </div>
            </td>
            <td style={{ color, fontWeight: 600, width: 90, whiteSpace: "nowrap", textAlign: "right" }}>
              {sign}
              {r.trendPct}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Переключатель площадки для виджета "Топ роста/падения" на дашборде — та
// же площадка, что и в разделах ниже, просто дашборд по умолчанию смотрит
// на все сразу ("Все площадки"), а тут можно переключиться на конкретную.
export default function TopMoversWidget({ scopes }: { scopes: MoverScope[] }) {
  const [activeCode, setActiveCode] = useState(scopes[0]?.code ?? "");
  const active = scopes.find((s) => s.code === activeCode) ?? scopes[0];
  if (!active) return null;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "#16a34a", fontWeight: 600, marginBottom: 8 }}>Растут</div>
          <MoverList rows={active.growth} color="#16a34a" sign="+" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "#b91c1c", fontWeight: 600, marginBottom: 8 }}>Падают</div>
          <MoverList rows={active.decline} color="#b91c1c" sign="" />
        </div>
      </div>
    </div>
  );
}
