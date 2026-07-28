import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";

const DAY_RANGES = new Set([7, 14, 30, 90]);

export async function GET(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent(req));
}

async function GETContent(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const rangeParam = searchParams.get("range") ?? "30";

  if (code !== "WB" && code !== "OZON" && code !== "YANDEX_MARKET") {
    return NextResponse.json({ error: "Некорректный код площадки" }, { status: 400 });
  }

  const marketplace = await prisma.marketplace.findFirst({ where: { code } });
  if (!marketplace) {
    return NextResponse.json({ code, granularity: "DAY", requestedRange: rangeParam, availableDays: 0, rows: [] });
  }

  if (rangeParam === "monthly") {
    // MONTH-строки как есть (сейчас пишет только Яндекс) + DAY-строки WB/Ozon,
    // свёрнутые по календарному месяцу — так переключатель "по месяцам"
    // работает одинаково для всех 3 площадок, а не только для Яндекса.
    const [monthRows, dayRows] = await Promise.all([
      prisma.marketplaceDailyFunnel.findMany({
        where: { marketplaceId: marketplace.id, granularity: "MONTH" },
        orderBy: { periodStart: "asc" },
      }),
      prisma.marketplaceDailyFunnel.findMany({
        where: { marketplaceId: marketplace.id, granularity: "DAY" },
        orderBy: { periodStart: "asc" },
      }),
    ]);

    const byMonth = new Map<
      string,
      { periodStart: string; orderedQty: number; boughtOutQty: number; cancelledQty: number; isProvisional: boolean }
    >();
    for (const r of monthRows) {
      const key = r.periodStart.toISOString().slice(0, 7);
      byMonth.set(key, {
        periodStart: r.periodStart.toISOString(),
        orderedQty: r.orderedQty,
        boughtOutQty: r.boughtOutQty,
        cancelledQty: r.cancelledQty,
        isProvisional: r.isProvisional,
      });
    }
    for (const r of dayRows) {
      const key = r.periodStart.toISOString().slice(0, 7);
      const existing = byMonth.get(key);
      if (existing) {
        existing.orderedQty += r.orderedQty;
        existing.boughtOutQty += r.boughtOutQty;
        existing.cancelledQty += r.cancelledQty;
        existing.isProvisional = existing.isProvisional || r.isProvisional;
      } else {
        byMonth.set(key, {
          periodStart: `${key}-01T00:00:00.000Z`,
          orderedQty: r.orderedQty,
          boughtOutQty: r.boughtOutQty,
          cancelledQty: r.cancelledQty,
          isProvisional: r.isProvisional,
        });
      }
    }

    const rows = Array.from(byMonth.values()).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    return NextResponse.json({ code, granularity: "MONTH", requestedRange: "monthly", availableDays: rows.length, rows });
  }

  const range = Number(rangeParam);
  if (!DAY_RANGES.has(range)) {
    return NextResponse.json({ error: "Некорректный диапазон — допустимо 7/14/30/90/monthly" }, { status: 400 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - range);

  const rows = await prisma.marketplaceDailyFunnel.findMany({
    where: { marketplaceId: marketplace.id, granularity: "DAY", periodStart: { gte: cutoff } },
    orderBy: { periodStart: "asc" },
  });

  return NextResponse.json({
    code,
    granularity: "DAY",
    requestedRange: range,
    availableDays: rows.length,
    rows: rows.map((r) => ({
      periodStart: r.periodStart.toISOString(),
      orderedQty: r.orderedQty,
      boughtOutQty: r.boughtOutQty,
      cancelledQty: r.cancelledQty,
      isProvisional: r.isProvisional,
    })),
  });
}
