"use client";

import { useMemo, useState } from "react";
import {
  computeUnitEconomics,
  maxCogsForTargetMargin,
  LINE_LABEL,
  type CostModel,
} from "@/lib/researchEconomics";

const rub = (n: number) => Math.round(n).toLocaleString("ru-RU") + " ₽";

const SRC_STYLE: Record<string, React.CSSProperties> = {
  тариф: { background: "rgba(80,160,255,0.15)", color: "#7fb3ff" },
  оценка: { background: "rgba(255,180,80,0.15)", color: "#ffb84d" },
  ввод: { background: "rgba(150,150,150,0.15)", color: "#aaa" },
};

export default function CostBreakdown({
  sellPrice,
  monthlyUnits,
  initialCogs,
  costModel,
}: {
  sellPrice: number;
  monthlyUnits: number;
  initialCogs: number;
  costModel: CostModel;
}) {
  const [cogs, setCogs] = useState(Math.round(initialCogs));
  const [adsPct, setAdsPct] = useState(Math.round(costModel.adsPct * 100));
  const [returnPct, setReturnPct] = useState(Math.round(costModel.returnRate * 100));
  const [volume, setVolume] = useState(costModel.volumeLiters);
  const [targetMargin, setTargetMargin] = useState(20);

  const model: CostModel = useMemo(
    () => ({ ...costModel, adsPct: adsPct / 100, returnRate: returnPct / 100, volumeLiters: volume }),
    [costModel, adsPct, returnPct, volume],
  );

  const econ = useMemo(
    () => computeUnitEconomics({ sellPrice, cogs, monthlyUnits, model }),
    [sellPrice, cogs, monthlyUnits, model],
  );
  const maxCogs = useMemo(
    () => maxCogsForTargetMargin({ sellPrice, targetMarginPct: targetMargin, model }),
    [sellPrice, targetMargin, model],
  );

  const num = (v: string) => (v === "" ? 0 : Number(v));
  const inputStyle: React.CSSProperties = { width: 70, padding: "2px 4px" };

  return (
    <div style={{ padding: "8px 4px", fontSize: 13 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
        <label>
          COGS, ₽{" "}
          <input type="number" style={inputStyle} value={cogs} onChange={(e) => setCogs(num(e.target.value))} />
        </label>
        <label>
          Реклама, %{" "}
          <input type="number" style={inputStyle} value={adsPct} onChange={(e) => setAdsPct(num(e.target.value))} />
        </label>
        <label>
          Возвраты, %{" "}
          <input type="number" style={inputStyle} value={returnPct} onChange={(e) => setReturnPct(num(e.target.value))} />
        </label>
        <label>
          Объём, л{" "}
          <input
            type="number"
            step="0.1"
            style={inputStyle}
            value={volume}
            onChange={(e) => setVolume(num(e.target.value))}
          />
        </label>
        <label>
          Цель маржи, %{" "}
          <input
            type="number"
            style={inputStyle}
            value={targetMargin}
            onChange={(e) => setTargetMargin(num(e.target.value))}
          />
        </label>
      </div>

      <table className="table-dense" style={{ maxWidth: 560 }}>
        <tbody>
          {Object.entries(econ.lineItems).map(([key, item]) => (
            <tr key={key}>
              <td>{LINE_LABEL[key] ?? key}</td>
              <td style={{ textAlign: "right" }}>−{rub(item.amount)}</td>
              <td>
                <span style={{ ...SRC_STYLE[item.source], padding: "1px 6px", borderRadius: 4, fontSize: 11 }}>
                  {item.source}
                </span>
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 600 }}>
            <td>Цена продажи</td>
            <td style={{ textAlign: "right" }}>{rub(econ.sellPrice)}</td>
            <td />
          </tr>
          <tr style={{ fontWeight: 600 }}>
            <td>Прибыль на юнит</td>
            <td
              className={econ.profitPerUnit >= 0 ? "margin-positive" : "margin-negative"}
              style={{ textAlign: "right" }}
            >
              {rub(econ.profitPerUnit)}
            </td>
            <td />
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 10, display: "flex", gap: 20, flexWrap: "wrap" }}>
        <span>
          Маржа: <strong className={econ.marginPct >= 0 ? "margin-positive" : "margin-negative"}>{econ.marginPct}%</strong>
        </span>
        <span>
          ROI: <strong>{econ.roiPct}%</strong>
        </span>
        <span>
          Прибыль/мес: <strong>{rub(econ.profitPerMonth)}</strong>
        </span>
        <span>
          Макс. закупка под {targetMargin}%: <strong>{rub(maxCogs)}</strong>
        </span>
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        <span style={{ ...SRC_STYLE["тариф"], padding: "1px 6px", borderRadius: 4 }}>тариф</span> — число из тарифов Ozon ·{" "}
        <span style={{ ...SRC_STYLE["оценка"], padding: "1px 6px", borderRadius: 4 }}>оценка</span> — гипотеза ·{" "}
        <span style={{ ...SRC_STYLE["ввод"], padding: "1px 6px", borderRadius: 4 }}>ввод</span> — твои данные. Тарифы Ozon
        FBS — ориентир на 2026-09, сверяйся с ЛК.
      </p>
    </div>
  );
}
