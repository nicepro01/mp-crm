import { NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { syncWbDailyFunnel } from "@/lib/marketplaceFunnelSync";

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, POSTContent);
}

async function POSTContent() {
  try {
    const summary = await syncWbDailyFunnel();
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от WB API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
