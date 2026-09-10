"use client";

import { useMemo, useState } from "react";
import {
  computeUnitEconomics,
  maxCogsForTargetMargin,
  summarizeEconomics,
  LINE_LABEL,
  type CostModel,
  type CostSource,
} from "@/lib/researchEconomics";

const rub = (n: number) => Math.round(n).toLocaleString("ru-RU") + " ₽";

const SRC_STYLE: Record<CostSource, React.CSSProperties> = {
  тариф: { background: "rgba(80,160,255,0.15)", color: "#7fb3ff" },
  оценка: { background: "rgba(255,180,80,0.15)", color: "#ffb84d" },
  ввод: { background: "rgba(150,150,150,0.15)", color: "#aaa" },
};
const Badge = ({ s }: { s: CostSource }) => (
  <span style={{ ...SRC_STYLE[s], padding: "1px 6px", borderRadius: 4, fontSize: 11 }}>{s}</span>
);

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
  const s = useMemo(() => summarizeEconomics(econ), [econ]);
  const maxCogs = useMemo(
    () => maxCogsForTargetMargin({ sellPrice, targetMarginPct: targetMargin, model }),
    [sellPrice, targetMargin, model],
  );

  const num = (v: string) => (v === "" ? 0 : Number(v));
  const inputStyle: React.CSSProperties = { width: 70, padding: "2px 4px" };
  const Row = ({ label, amount, badge, kind }: { label: string; amount: number; badge?: CostSource; kind?: "sum" | "final" }) => {
    const isTotal = kind === "sum" || kind === "final";
    return (
      <tr
        style={
          kind === "sum"
            ? { borderTop: "1px solid var(--border)", fontWeight: 600 }
            : kind === "final"
              ? { borderTop: "2px solid var(--border)", fontWeight: 700 }
              : undefined
        }
      >
        <td style={{ padding: "3px 8px" }}>{label}</td>
        <td
          style={{ textAlign: "right", padding: "3px 8px", whiteSpace: "nowrap" }}
          className={kind === "final" ? (amount >= 0 ? "margin-positive" : "margin-negative") : undefined}
        >
          {isTotal ? rub(amount) : "−" + rub(amount)}
        </td>
        <td style={{ padding: "3px 8px" }}>{badge && <Badge s={badge} />}</td>
      </tr>
    );
  };

  return (
    <div style={{ padding: "8px 4px", fontSize: 13 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <label>COGS, ₽ <input type="number" style={inputStyle} value={cogs} onChange={(e) => setCogs(num(e.target.value))} /></label>
        <label>Реклама, % <input type="number" style={inputStyle} value={adsPct} onChange={(e) => setAdsPct(num(e.target.value))} /></label>
        <label>Возвраты, % <input type="number" style={inputStyle} value={returnPct} onChange={(e) => setReturnPct(num(e.target.value))} /></label>
        <label>Объём, л <input type="number" step="0.1" style={inputStyle} value={volume} onChange={(e) => setVolume(num(e.target.value))} /></label>
        <label>Цель маржи, % <input type="number" style={inputStyle} value={targetMargin} onChange={(e) => setTargetMargin(num(e.target.value))} /></label>
      </div>

      <table className="table-dense" style={{ maxWidth: 620 }}>
        <tbody>
          <Row label="Покупатель платит" amount={s.sellPrice} kind="sum" />

          {s.ozon.map((x) => (
            <Row key={x.key} label={LINE_LABEL[x.key] ?? x.key} amount={x.amount} badge={x.source} />
          ))}
          <Row label="К выплате от Ozon" amount={s.payout} kind="sum" />

          <Row label="Реклама Ozon" amount={s.ads} badge="оценка" />
          {s.mine.map((x) => (
            <Row key={x.key} label={LINE_LABEL[x.key] ?? x.key} amount={x.amount} badge={x.source} />
          ))}
          <Row label={`Налог УСН 6% (с ${rub(s.sellPrice)})`} amount={s.tax} badge="тариф" />

          <Row label="Чистыми на юнит" amount={s.netProfit} kind="final" />
        </tbody>
      </table>

      <div style={{ marginTop: 12, display: "flex", gap: 20, flexWrap: "wrap" }}>
        <span>Маржа: <strong className={s.marginPct >= 0 ? "margin-positive" : "margin-negative"}>{s.marginPct}%</strong></span>
        <span>ROI на вложения: <strong>{s.roiPct}%</strong></span>
        <span>Чистыми в месяц (~{monthlyUnits} шт): <strong>{rub(s.profitPerMonth)}</strong></span>
        <span>Макс. закупка под {targetMargin}%: <strong>{rub(maxCogs)}</strong></span>
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        <Badge s="тариф" /> число из тарифов Ozon · <Badge s="оценка" /> гипотеза · <Badge s="ввод" /> твои данные.
        {" "}Налог УСН 6% считается с полной цены (1 690 ₽), а не с выплаты. Тарифы Ozon FBS — ориентир на 2026-09,
        сверяйся с ЛК.
      </p>
    </div>
  );
}
