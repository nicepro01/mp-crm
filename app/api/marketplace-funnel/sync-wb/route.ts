import { NextRequest, NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { syncWbDailyFunnel } from "@/lib/marketplaceFunnelSync";
import { resolveMarketplace } from "@/lib/resolveMarketplace";

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const marketplace = await resolveMarketplace("WB", body?.marketplaceId);
    const summary = await syncWbDailyFunnel(marketplace);
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от WB API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
