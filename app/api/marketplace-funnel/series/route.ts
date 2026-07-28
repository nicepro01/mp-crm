import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";

const DAY_RANGES = new Set([7, 14, 30, 90]);

type Row = {
  periodStart: string;
  orderedQty: number;
  boughtOutQty: number;
  cancelledQty: number;
  orderedSumRub: number;
  boughtOutSumRub: number;
  cancelledSumRub: number;
  isProvisional: boolean;
};

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

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

    const byMonth = new Map<string, Row>();
    // Сколько дневных строк реально попало в месяц — WB/Ozon хранят только то,
    // что успело накопиться (см. lib/marketplaceFunnelSync.ts), а не весь
    // календарный месяц целиком. Если дней меньше, чем в месяце — это
    // НЕПОЛНЫЙ месяц, а не "настоящий" итог, и цифры занижены — помечаем
    // isProvisional, чтобы UI честно это показал, а не выдавал за финал.
    const dayCountByMonth = new Map<string, number>();
    for (const r of monthRows) {
      const key = r.periodStart.toISOString().slice(0, 7);
      byMonth.set(key, {
        periodStart: r.periodStart.toISOString(),
        orderedQty: r.orderedQty,
        boughtOutQty: r.boughtOutQty,
        cancelledQty: r.cancelledQty,
        orderedSumRub: Number(r.orderedSumRub),
        boughtOutSumRub: Number(r.boughtOutSumRub),
        cancelledSumRub: Number(r.cancelledSumRub),
        isProvisional: r.isProvisional,
      });
    }
    for (const r of dayRows) {
      const key = r.periodStart.toISOString().slice(0, 7);
      dayCountByMonth.set(key, (dayCountByMonth.get(key) ?? 0) + 1);
      const existing = byMonth.get(key);
      if (existing) {
        existing.orderedQty += r.orderedQty;
        existing.boughtOutQty += r.boughtOutQty;
        existing.cancelledQty += r.cancelledQty;
        existing.orderedSumRub += Number(r.orderedSumRub);
        existing.boughtOutSumRub += Number(r.boughtOutSumRub);
        existing.cancelledSumRub += Number(r.cancelledSumRub);
        existing.isProvisional = existing.isProvisional || r.isProvisional;
      } else {
        byMonth.set(key, {
          periodStart: `${key}-01T00:00:00.000Z`,
          orderedQty: r.orderedQty,
          boughtOutQty: r.boughtOutQty,
          cancelledQty: r.cancelledQty,
          orderedSumRub: Number(r.orderedSumRub),
          boughtOutSumRub: Number(r.boughtOutSumRub),
          cancelledSumRub: Number(r.cancelledSumRub),
          isProvisional: r.isProvisional,
        });
      }
    }

    // Помечаем неполные месяцы ПОСЛЕ агрегации — только для месяцев, у которых
    // источник вообще был DAY (dayCountByMonth), MONTH-строки Яндекса (без
    // записи в dayCountByMonth) неполными не бывают по определению отчёта.
    for (const [key, dayCount] of dayCountByMonth) {
      const [y, m] = key.split("-").map(Number);
      if (dayCount < daysInMonth(y, m - 1)) {
        const row = byMonth.get(key);
        if (row) row.isProvisional = true;
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
    rows: rows.map(
      (r): Row => ({
        periodStart: r.periodStart.toISOString(),
        orderedQty: r.orderedQty,
        boughtOutQty: r.boughtOutQty,
        cancelledQty: r.cancelledQty,
        orderedSumRub: Number(r.orderedSumRub),
        boughtOutSumRub: Number(r.boughtOutSumRub),
        cancelledSumRub: Number(r.cancelledSumRub),
        isProvisional: r.isProvisional,
      })
    ),
  });
}
