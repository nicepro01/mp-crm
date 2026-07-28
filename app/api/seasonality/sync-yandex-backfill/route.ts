import { NextRequest, NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { syncSeasonalityFromYandexMarketBackfill } from "@/lib/seasonalitySync";

// Может идти десятки минут (рейт-лимит Яндекса — 1 запрос генерации отчёта
// в 2 мин, общий на обе кампании) — изначально не рассчитан на serverless с
// коротким таймаутом. 300 — максимум, который Vercel вообще разрешает для
// serverless-функции на тарифе Hobby (на других тарифах лимит выше, но всё
// равно меньше времени, чем нужно для полного бэкфилла на много месяцев
// сразу) — на Vercel имеет смысл запрашивать monthsBack=1 за один вызов,
// нажимая кнопку повторно для каждого следующего месяца.
export const maxDuration = 300;

// Раньше без сессионной обёртки — вызов вне runWithTenant() падал с "Нет
// контекста компании" (см. lib/tenantContext.ts). Тот же паттерн, что и у
// остальных sync-роутов.
export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const monthsBack = Math.min(Math.max(Number(body?.monthsBack) || 3, 1), 12);

  try {
    const summary = await syncSeasonalityFromYandexMarketBackfill(monthsBack);
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Yandex Market API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
