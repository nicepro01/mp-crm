import { NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { syncSeasonalityFromYandexMarket } from "@/lib/seasonalitySync";

// Раньше без сессионной обёртки — вызов вне runWithTenant() падал с "Нет
// контекста компании" (см. lib/tenantContext.ts). Тот же паттерн, что и у
// остальных sync-роутов.
export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, POSTContent);
}

async function POSTContent() {
  try {
    const summary = await syncSeasonalityFromYandexMarket();
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Yandex Market API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
