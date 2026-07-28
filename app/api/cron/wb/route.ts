import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenantContext";
import { runFullWbSync } from "@/lib/dailySync";

// Вызывается Vercel Cron раз в сутки (00:00 МСК = 21:00 UTC, см.
// vercel.json) — Vercel сам подставляет заголовок Authorization: Bearer
// <CRON_SECRET>, если эта переменная задана в окружении проекта. Никакой
// сессии тут нет и быть не может (это не запрос от залогиненного
// пользователя), поэтому проверка отдельная от обычных API-роутов.
export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  // Company/User вне автофильтрации companyId (см. UNSCOPED_MODELS в
  // lib/prisma.ts) — можно спокойно запрашивать без tenant-контекста.
  const companies = await prisma.company.findMany({ include: { users: true } });
  const results: Record<string, unknown> = {};

  for (const company of companies) {
    const userId = company.users[0]?.id ?? company.id;
    try {
      results[company.id] = await runWithTenant({ companyId: company.id, userId }, runFullWbSync);
    } catch (err: any) {
      // Одна упавшая компания (напр. сбой БД на полпути) не должна обрывать
      // цикл по остальным.
      results[company.id] = { error: err?.message ?? "неизвестная ошибка" };
    }
  }

  return NextResponse.json({ companiesProcessed: companies.length, results });
}
