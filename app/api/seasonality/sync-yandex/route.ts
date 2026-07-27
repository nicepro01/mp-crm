import { NextResponse } from "next/server";
import { syncSeasonalityFromYandexMarket } from "@/lib/seasonalitySync";

export async function POST() {
  try {
    const summary = await syncSeasonalityFromYandexMarket();
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Yandex Market API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
