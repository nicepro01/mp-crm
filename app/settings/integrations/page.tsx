import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import IntegrationsForm from "./IntegrationsForm";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => IntegrationsPageContent());
}

async function IntegrationsPageContent() {
  const marketplaces = await prisma.marketplace.findMany({ orderBy: { code: "asc" } });

  const rows = marketplaces.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    credentials: (m.credentials as Record<string, string> | null) ?? {},
  }));

  return (
    <div>
      <div className="toolbar">
        <h1>Настройки → Интеграции</h1>
      </div>
      <p className="muted">
        Свои учётные данные API для каждой площадки — свои у каждой компании, синки (остатки,
        юнит-экономика, сезонность) используют их вместо общих для всех переменных окружения.
      </p>
      {rows.length === 0 ? (
        <p className="muted">
          Площадки ещё не добавлены — сначала добавьте WB/Ozon/Яндекс.Маркет на странице{" "}
          <a href="/marketplaces/new">«Площадки»</a>, затем возвращайтесь сюда за токенами.
        </p>
      ) : (
        <IntegrationsForm rows={rows} />
      )}
    </div>
  );
}
