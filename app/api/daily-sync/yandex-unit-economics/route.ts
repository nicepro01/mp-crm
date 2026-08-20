import { NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { runYandexUnitEconomicsSync } from "@/lib/dailySync";

// См. app/api/daily-sync/ozon-unit-economics/route.ts — тот же приём для Яндекса.
export const maxDuration = 300;

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  const result = await runWithTenant(session, runYandexUnitEconomicsSync);
  return NextResponse.json(result);
}
