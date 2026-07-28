import { NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { runFullYandexSync } from "@/lib/dailySync";

// Яндекс — самый долгий из трёх (собственный жёсткий рейт-лимит площадки,
// не наш выбор — см. lib/marketplaceFunnelSync.ts), поэтому именно он
// определяет общее время ожидания кнопки "Обновить всё" (WB/Ozon идут
// параллельно и заканчиваются раньше).
export const maxDuration = 300;

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  const result = await runWithTenant(session, runFullYandexSync);
  return NextResponse.json(result);
}
