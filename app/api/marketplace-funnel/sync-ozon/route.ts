import { NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { syncOzonDailyFunnel } from "@/lib/marketplaceFunnelSync";

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, POSTContent);
}

async function POSTContent() {
  try {
    const summary = await syncOzonDailyFunnel();
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Ozon API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
