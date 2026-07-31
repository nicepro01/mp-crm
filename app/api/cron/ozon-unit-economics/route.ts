import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenantContext";
import { runOzonUnitEconomicsSync } from "@/lib/dailySync";

// Один из 4 отдельных ночных cron-вызовов для Ozon (см. lib/dailySync.ts —
// комментарий у runOzonSubSync) — раньше был один общий /api/cron/ozon на
// все 4 под-синка сразу, но с реальными данными это упиралось в лимит
// Vercel Hobby (300с), даже когда магазины одного кода уже шли параллельно
// друг другу. Разбито на 4 независимых вызова с общим ночным расписанием
// (см. vercel.json), у каждого свой полный бюджет в 300с.
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

  const companies = await prisma.company.findMany({ include: { users: true } });
  const results: Record<string, unknown> = {};

  for (const company of companies) {
    const userId = company.users[0]?.id ?? company.id;
    try {
      results[company.id] = await runWithTenant({ companyId: company.id, userId }, runOzonUnitEconomicsSync);
    } catch (err: any) {
      results[company.id] = { error: err?.message ?? "неизвестная ошибка" };
    }
  }

  return NextResponse.json({ companiesProcessed: companies.length, results });
}
