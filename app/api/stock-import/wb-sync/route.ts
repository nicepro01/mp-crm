import { NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { syncWbStockImport } from "@/lib/stockImportSync";
import { MarketplaceNotConfiguredError } from "@/lib/syncErrors";

export async function POST() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, POSTContent);
}

async function POSTContent() {
  try {
    const summary = await syncWbStockImport();
    return NextResponse.json(summary);
  } catch (err: any) {
    if (err instanceof MarketplaceNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: `Не удалось получить данные от WB API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
