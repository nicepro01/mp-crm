import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import PlannerForm from "./PlannerForm";
import { buildPlannerData } from "./plannerData";

export const dynamic = "force-dynamic";

export default async function BatchPlannerPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => BatchPlannerPageContent());
}

async function BatchPlannerPageContent() {
  const data = await buildPlannerData("CHINA");

  if (!data) {
    return (
      <div>
        <h1>Планировщик поставок (Китай)</h1>
        <p className="muted">
          Пока нет ни одного активного листинга у китайских поставщиков —
          добавьте товары на площадках на странице «Площадки», чтобы здесь
          появился расчёт, что и сколько заказывать.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Планировщик поставок (Китай)</h1>
      <p className="muted">
        Отметьте нужные товары, поправьте количество и цену закупки — и
        сразу оформится поставка со всеми позициями.{" "}
        <a href="/batches/plan-ru">Российские поставщики — отдельная страница</a>.
      </p>
      <PlannerForm
        rows={data.rows}
        marketplaceStats={data.marketplaceStats}
        warehouseStatsByProduct={data.warehouseStatsByProduct}
        marketplaceNames={data.marketplaceNames}
      />
    </div>
  );
}
