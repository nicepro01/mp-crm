import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

// Отдельный, облегчённый экземпляр NextAuth (без Credentials-провайдера и
// без Prisma) — именно поэтому конфиг вынесен в lib/auth.config.ts, а не
// импортируется из lib/auth.ts напрямую (тот тянет Prisma Client, который в
// Edge Runtime, где выполняется middleware, не работает).
const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = new Set([
  "/login",
  "/signup",
  "/api/signup",
  "/forgot-password",
  "/api/forgot-password",
  "/reset-password",
  "/api/reset-password",
  // Vercel Cron вызывает эти пути без сессии (вообще без cookie) — свою
  // защиту делают сами роуты через заголовок Authorization: Bearer
  // <CRON_SECRET> (см. app/api/cron/*/route.ts), а не через логин.
  "/api/cron/wb",
  "/api/cron/yandex",
  // Ozon разбит на 4 отдельных ночных вызова (юнит-экономика/график/
  // сезонность/остатки) — общий синк на все под-синки сразу упирался в
  // лимит времени Vercel Hobby (см. lib/dailySync.ts).
  "/api/cron/ozon-unit-economics",
  "/api/cron/ozon-funnel",
  "/api/cron/ozon-seasonality",
  "/api/cron/ozon-stock-import",
]);

// Без сессии: публичные страницы/API пропускаем как есть, остальные API —
// 401 JSON (а не редирект — fetch() иначе тихо получит HTML логина вместо
// ожидаемого JSON), остальные страницы — редирект на /login.
export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (req.auth || PUBLIC_PATHS.has(pathname)) {
    return;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", req.url));
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
