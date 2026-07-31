import { NextRequest, NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { syncSeasonalityFromOzon } from "@/lib/seasonalitySync";
import { resolveMarketplace } from "@/lib/resolveMarketplace";

// Раньше без сессионной обёртки — вызов вне runWithTenant() падал с "Нет
// контекста компании" (см. lib/tenantContext.ts). Тот же паттерн, что и у
// остальных sync-роутов.
export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const marketplace = await resolveMarketplace("OZON", body?.marketplaceId);
    const summary = await syncSeasonalityFromOzon(marketplace);
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Ozon API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
