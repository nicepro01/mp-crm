import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import PlannerForm from "../plan/PlannerForm";
import { buildPlannerData } from "../plan/plannerData";

export const dynamic = "force-dynamic";

// Отдельная страница для российских поставщиков (Грал/Маяк/Сонатекс/ИП
// Тимур и т.д.) — тот же расчёт и тот же способ оформления поставки
// (см. app/batches/plan/plannerData.ts), что и у китайского планировщика,
// просто отдельно от него: у российских поставщиков в разы короче лид-тайм
// (дни-недели против ~120 дней у Китая), и в одном списке с полутора
// сотнями китайских SKU они просто теряются.
export default async function BatchPlannerRuPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => BatchPlannerRuPageContent());
}

async function BatchPlannerRuPageContent() {
  const data = await buildPlannerData("RUSSIA");

  if (!data) {
    return (
      <div>
        <h1>Планировщик поставок (Россия)</h1>
        <p className="muted">
          Пока нет ни одного активного листинга у российских поставщиков —
          убедитесь, что у поставщика указана страна «Россия» (страница
          «Поставщики») и товар привязан к нему как основной.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Планировщик поставок (Россия)</h1>
      <p className="muted">
        Отметьте нужные товары, поправьте количество и цену закупки — и
        сразу оформится поставка со всеми позициями.{" "}
        <a href="/batches/plan">Китайские поставщики — отдельная страница</a>.
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
