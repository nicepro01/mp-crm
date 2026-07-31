import { NextRequest, NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { syncYandexFunnelBackfill } from "@/lib/marketplaceFunnelSync";
import { resolveMarketplace } from "@/lib/resolveMarketplace";

// Тот же лимит, что и у app/api/seasonality/sync-yandex-backfill/route.ts —
// максимум, который Vercel Hobby разрешает для serverless-функции. Вызывать
// с monthsBack=1 за раз (см. комментарий в lib/marketplaceFunnelSync.ts).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const monthsBack = Math.min(Math.max(Number(body?.monthsBack) || 1, 1), 12);

  try {
    const marketplace = await resolveMarketplace("YANDEX_MARKET", body?.marketplaceId);
    const summary = await syncYandexFunnelBackfill(marketplace, monthsBack);
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Yandex Market API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
