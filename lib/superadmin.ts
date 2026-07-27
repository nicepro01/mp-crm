import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Список через запятую в переменной окружения — проще, чем заводить роль
// в БД ради одного человека (владельца всего сервиса, не компании).
function superAdminEmails(): string[] {
  return (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return superAdminEmails().includes(email.toLowerCase());
}

// Для app/admin/* страниц — редиректит на /login, если не супер-админ.
export async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user || !isSuperAdminEmail(session.user.email)) {
    redirect("/login");
  }
  return session;
}
