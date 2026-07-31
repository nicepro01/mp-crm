import { NextRequest, NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { syncOzonDailyFunnel } from "@/lib/marketplaceFunnelSync";
import { resolveMarketplace } from "@/lib/resolveMarketplace";

// В отличие от WB (жёсткий обрыв API на ~30 днях), у Ozon глубина окна —
// наш собственный выбор, не ограничение площадки. Разово можно запросить
// глубокий бэкфилл через body {windowDays}, поэтому нужен запас по времени
// (пагинация по FBO+FBS может занять заметно дольше 90-дневного окна) — тот
// же потолок, что и на Vercel Hobby у Yandex-бэкфилла.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const windowDays = Math.min(Math.max(Number(body?.windowDays) || 90, 1), 365);

  try {
    const marketplace = await resolveMarketplace("OZON", body?.marketplaceId);
    const summary = await syncOzonDailyFunnel(marketplace, windowDays);
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Ozon API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
