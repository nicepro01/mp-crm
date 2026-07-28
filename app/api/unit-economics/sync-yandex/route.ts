import { NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { syncYandexUnitEconomics } from "@/lib/unitEconomicsSync";
import { MarketplaceNotConfiguredError } from "@/lib/syncErrors";

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, POSTContent);
}

async function POSTContent() {
  try {
    const summary = await syncYandexUnitEconomics();
    return NextResponse.json(summary);
  } catch (err: any) {
    if (err instanceof MarketplaceNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: `Не удалось получить данные от Yandex Market API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
