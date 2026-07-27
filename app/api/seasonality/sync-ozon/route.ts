import { NextResponse } from "next/server";
import { syncSeasonalityFromOzon } from "@/lib/seasonalitySync";

export async function POST() {
  try {
    const summary = await syncSeasonalityFromOzon();
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от Ozon API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
