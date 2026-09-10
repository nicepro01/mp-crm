import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { getResearchCandidates, type ResearchCandidate, type ResearchStatus } from "@/lib/research";
import ResearchActions from "./ResearchActions";
import CostBreakdown from "./CostBreakdown";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => ResearchPageContent());
}

const STATUS_LABEL: Record<ResearchStatus, string> = {
  new: "новый",
  actionable: "✅ готов",
  review: "🔸 проверить",
  rejected: "отклонён",
  no_match: "нет поставщика",
  approved: "★ в тесте",
  snoozed: "отложен",
};

const STATUS_ORDER: ResearchStatus[] = ["actionable", "review", "approved", "no_match", "snoozed", "rejected", "new"];

const rub = (n: number | null) =>
  n === null ? "—" : Math.round(n).toLocaleString("ru-RU") + " ₽";
const pct = (n: number | null) => (n === null ? "—" : Math.round(n) + "%");

async function ResearchPageContent() {
  const { candidates, error } = await getResearchCandidates();

  const shown = candidates.filter((c) => c.status !== "new");
  shown.sort((a, b) => {
    const s = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (s !== 0) return s;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  const counts = {
    actionable: candidates.filter((c) => c.status === "actionable").length,
    review: candidates.filter((c) => c.status === "review").length,
    approved: candidates.filter((c) => c.status === "approved").length,
  };

  return (
    <div>
      <h1>Подбор товаров</h1>
      <p className="muted">
        Ниши с Ozon (MPStat) → юнит-экономика по FBS → поставщик с Wikkeo. Наполняет сервис mp-research.
        {" "}Готовых: <strong>{counts.actionable}</strong> · на проверку: <strong>{counts.review}</strong> · в тесте:{" "}
        <strong>{counts.approved}</strong>
      </p>

      {error && (
        <p className="error">
          Данные подбора недоступны: {error}. Запустите сервис mp-research (COMPANY_ID + npm run pipeline).
        </p>
      )}

      {!error && shown.length === 0 && (
        <p className="muted">Кандидатов пока нет. Прогоните конвейер mp-research.</p>
      )}

      {shown.length > 0 && (
        <div className="table-scroll">
          <table className="table-dense">
            <thead>
              <tr>
                <th>Статус</th>
                <th>Ниша / товар</th>
                <th style={{ textAlign: "right" }}>Цена Ozon</th>
                <th style={{ textAlign: "right" }}>Прод./мес</th>
                <th style={{ textAlign: "right" }}>Макс. закупка</th>
                <th style={{ textAlign: "right" }}>Прибыль/мес</th>
                <th style={{ textAlign: "right" }}>Маржа</th>
                <th style={{ textAlign: "right" }}>ROI</th>
                <th style={{ textAlign: "right" }}>Score</th>
                <th>Поставщик Wikkeo</th>
                <th>Решение</th>
              </tr>
            </thead>
            <tbody>
              {shown.flatMap((c: ResearchCandidate) => [
                <tr key={c.id}>
                  <td>{STATUS_LABEL[c.status] ?? c.status}</td>
                  <td>
                    <div>{c.refTitle ?? "—"}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{c.categoryPath}</div>
                  </td>
                  <td style={{ textAlign: "right" }}>{rub(c.refPrice)}</td>
                  <td style={{ textAlign: "right" }}>{c.refMonthlyUnits}</td>
                  <td style={{ textAlign: "right" }}>{rub(c.maxCogs)}</td>
                  <td style={{ textAlign: "right" }}>{rub(c.profitPerMonth)}</td>
                  <td style={{ textAlign: "right" }}>{pct(c.marginPct)}</td>
                  <td style={{ textAlign: "right" }}>{pct(c.roiPct)}</td>
                  <td style={{ textAlign: "right" }}>{c.score === null ? "—" : Math.round(c.score)}</td>
                  <td>
                    {c.match ? (
                      <>
                        <a href={c.match.url} target="_blank" rel="noreferrer">
                          {rub(c.match.price)}
                        </a>{" "}
                        <span className={c.match.priceFits ? "margin-positive" : "margin-negative"}>
                          {c.match.priceFits ? "в цене" : "дорого"}
                        </span>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {c.match.store} · conf {c.match.confidence.toFixed(2)}
                        </div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <ResearchActions id={c.id} status={c.status} />
                  </td>
                </tr>,
                <tr key={c.id + "-econ"}>
                  <td colSpan={11} style={{ paddingTop: 0 }}>
                    <details>
                      <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Расшивка расходов / «что если»</summary>
                      <CostBreakdown
                        sellPrice={c.refPrice}
                        monthlyUnits={c.refMonthlyUnits}
                        initialCogs={
                          c.match && c.match.priceFits ? c.match.price : c.maxCogs ?? Math.round(c.refPrice * 0.3)
                        }
                        costModel={c.costModel}
                      />
                    </details>
                  </td>
                </tr>,
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
