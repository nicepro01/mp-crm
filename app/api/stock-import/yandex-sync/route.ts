import { NextRequest, NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { syncYandexStockImport } from "@/lib/stockImportSync";
import { MarketplaceNotConfiguredError } from "@/lib/syncErrors";
import { resolveMarketplace } from "@/lib/resolveMarketplace";

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const marketplace = await resolveMarketplace("YANDEX_MARKET", body?.marketplaceId);
    const summary = await syncYandexStockImport(marketplace);
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
