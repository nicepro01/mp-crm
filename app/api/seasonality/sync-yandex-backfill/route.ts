import { NextResponse } from "next/server";
import { syncSeasonalityFromYandexMarketBackfill } from "@/lib/seasonalitySync";

// Может идти десятки минут (рейт-лимит Яндекса — 1 запрос генерации отчёта
// в 2 мин, общий на обе кампании) — не рассчитан на serverless с коротким
// таймаутом, только на длительно живущий процесс (как в этом проекте).
export const maxDuration = 3600;

export async function POST(req: Request) {
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
