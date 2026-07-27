import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export type TenantSession = { companyId: string; userId: string };

// Для page.tsx — редиректит на /login, если сессии нет. Каждая страница
// вызывает это первой строкой, дальше оборачивает тело в
// runWithTenant(session, ...) (см. lib/tenantContext.ts).
export async function requireTenantSession(): Promise<TenantSession> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return { companyId: session.user.companyId, userId: session.user.id };
}

// Для route.ts — на страницу не редиректнуть, поэтому возвращает null и
// вызывающий сам решает, что ответить (обычно unauthorizedResponse() ниже).
export async function getApiTenantSession(): Promise<TenantSession | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { companyId: session.user.companyId, userId: session.user.id };
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
}
