"use client";

import { useState } from "react";
import PhotoThumb from "@/app/products/PhotoThumb";

type Row = {
  id: string;
  sku: string;
  name: string;
  photoUrl: string | null;
  issues: { severity: string; text: string }[];
  worstSeverity: number;
  criticalCount: number;
  totalCount: number;
};

const ISSUE_BORDER: Record<string, string> = {
  critical: "#dc2626",
  warning: "#d97706",
  info: "#3b82f6",
};
const ISSUE_TEXT_CLASS: Record<string, string> = {
  critical: "margin-negative",
  warning: "",
  info: "muted",
};

const OPP_BORDER: Record<string, string> = {
  top: "#16a34a",
  good: "#16a34a",
  growth: "#7c3aed",
};
const OPP_TEXT_CLASS: Record<string, string> = {
  top: "margin-positive",
  good: "margin-positive",
  growth: "",
};

// "Все товары" — объединённый срез: и проблемы, и топы вперемешку в одной
// карточке на товар (уже отсортированы по важности внутри самой карточки —
// см. buildCombinedMarketplaceRows в page.tsx), чтобы не скакать между
// вкладками "Топы"/"Рекомендации" ради полной картины по одному товару.
const COMBINED_BORDER: Record<string, string> = { ...ISSUE_BORDER, ...OPP_BORDER };
const COMBINED_TEXT_CLASS: Record<string, string> = { ...ISSUE_TEXT_CLASS, ...OPP_TEXT_CLASS };

// Список товаров по одному из срезов — "Рекомендации" (что исправить),
// "Топы" (что усилить, раз оно и так хорошо работает), либо "combined" (оба
// сразу, вперемешку в одной карточке — вкладка "Все товары"). fixedMode
// задан — режим переключать некуда, компонент используется как отдельная
// вкладка, тогда показываем только фильтр "только с находками / все
// товары" для одного этого среза. fixedMode не задан — старое поведение
// (сводная вкладка "Все площадки"): переключатель режима сверху.
export default function RecommendationsFilterList({
  issueRows,
  opportunityRows,
  combinedRows,
  fixedMode,
}: {
  issueRows: Row[];
  opportunityRows: Row[];
  combinedRows?: Row[];
  fixedMode?: "issues" | "opportunities" | "combined";
}) {
  const [modeState, setMode] = useState<"issues" | "opportunities">("issues");
  const mode = fixedMode ?? modeState;
  const [onlyFlagged, setOnlyFlagged] = useState(true);

  const rows = mode === "combined" ? combinedRows ?? [] : mode === "issues" ? issueRows : opportunityRows;
  const borderMap = mode === "combined" ? COMBINED_BORDER : mode === "issues" ? ISSUE_BORDER : OPP_BORDER;
  const textClassMap = mode === "combined" ? COMBINED_TEXT_CLASS : mode === "issues" ? ISSUE_TEXT_CLASS : OPP_TEXT_CLASS;
  const flagged = rows.filter((r) => r.totalCount > 0);
  const visibleRows = onlyFlagged ? flagged : rows;

  return (
    <div>
      {!fixedMode && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className={mode === "issues" ? "btn" : "btn btn-secondary"}
            onClick={() => setMode("issues")}
          >
            ⚠️ Проблемы ({issueRows.filter((r) => r.totalCount > 0).length})
          </button>
          <button
            type="button"
            className={mode === "opportunities" ? "btn" : "btn btn-secondary"}
            onClick={() => setMode("opportunities")}
          >
            🏆 Топы ({opportunityRows.filter((r) => r.totalCount > 0).length})
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className={onlyFlagged ? "btn" : "btn btn-secondary"}
          onClick={() => setOnlyFlagged(true)}
        >
          {mode === "issues" ? "Только с проблемами" : mode === "opportunities" ? "Только топы" : "Только с находками"} ({flagged.length})
        </button>
        <button
          type="button"
          className={!onlyFlagged ? "btn" : "btn btn-secondary"}
          onClick={() => setOnlyFlagged(false)}
        >
          Все товары ({rows.length})
        </button>
      </div>
      {visibleRows.length === 0 ? (
        <p className="muted">
          {mode === "issues"
            ? "Проблем не найдено — по всем товарам данные в норме."
            : mode === "opportunities"
              ? "Явных топов не найдено по текущим данным."
              : "Ничего не найдено по текущим данным."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleRows.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                gap: 16,
                padding: 16,
                background: "var(--surface)",
                borderRadius: 8,
                boxShadow: "0 1px 3px var(--shadow)",
                borderLeft: `3px solid ${r.totalCount === 0 ? "transparent" : borderMap[r.issues[0].severity] ?? "transparent"}`,
              }}
            >
              <PhotoThumb url={r.photoUrl} size={64} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <strong>{r.sku}</strong>
                    <div className="muted">{r.name}</div>
                  </div>
                  {r.totalCount > 0 && (
                    <div className="muted" style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                      {(mode === "issues" || mode === "combined") && r.criticalCount > 0
                        ? `${r.criticalCount} критично`
                        : mode === "opportunities"
                          ? `${r.totalCount} находк${r.totalCount === 1 ? "а" : "и"}`
                          : `${r.totalCount} момент${r.totalCount === 1 ? "" : "а"}`}
                    </div>
                  )}
                </div>
                {r.totalCount === 0 ? (
                  <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                    {mode === "issues"
                      ? "Товар в порядке — не требует внимания по текущим данным."
                      : mode === "opportunities"
                        ? "По текущим данным ничего выдающегося не найдено."
                        : "По текущим данным ничего существенного не найдено."}
                  </p>
                ) : (
                  <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18 }}>
                    {r.issues.map((issue, i) => (
                      <li key={i} className={textClassMap[issue.severity]} style={{ marginBottom: 2 }}>
                        {issue.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
