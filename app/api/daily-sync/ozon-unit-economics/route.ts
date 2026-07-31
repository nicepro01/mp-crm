import { NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { runOzonUnitEconomicsSync } from "@/lib/dailySync";

// Один из 4 отдельных вызовов для Ozon (см. lib/dailySync.ts) — раньше был
// один /api/daily-sync/ozon на все под-синки сразу, разбито из-за лимита
// времени Vercel Hobby (см. app/api/cron/ozon-unit-economics/route.ts).
export const maxDuration = 300;

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  const result = await runWithTenant(session, runOzonUnitEconomicsSync);
  return NextResponse.json(result);
}
