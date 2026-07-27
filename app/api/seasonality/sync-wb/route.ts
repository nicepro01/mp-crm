import { NextResponse } from "next/server";
import { syncSeasonalityFromWb } from "@/lib/seasonalitySync";

export async function POST() {
  try {
    const summary = await syncSeasonalityFromWb();
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Не удалось получить данные от WB API: ${err.message ?? "неизвестная ошибка"}` },
      { status: 502 }
    );
  }
}
