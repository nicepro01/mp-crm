import { NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { runFullWbSync } from "@/lib/dailySync";

// Ручной запуск ВСЕХ синков WB сразу (юнит-экономика + графики заказов +
// сезонность + импорт остатков + возвраты) для текущей компании — цель
// кнопки "Обновить всё" в шапке (см. app/RefreshAllButton.tsx). Может идти
// до пары минут (упирается в собственные рейт-лимиты WB), поэтому 300с —
// тот же потолок, что и у остальных долгих синков в проекте.
export const maxDuration = 300;

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  const result = await runWithTenant(session, runFullWbSync);
  return NextResponse.json(result);
}
