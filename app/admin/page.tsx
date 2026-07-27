import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/superadmin";
import AdminUsersTable from "./AdminUsersTable";

export const dynamic = "force-dynamic";

// User/Company — вне автофильтрации companyId (см. UNSCOPED_MODELS в
// lib/prisma.ts), поэтому здесь не нужен runWithTenant — это единственное
// место в приложении, которое сознательно смотрит НА ВСЕ компании сразу.
export default async function AdminPage() {
  const session = await requireSuperAdmin();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });

  const rows = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    position: u.position,
    approved: u.approved,
    createdAt: u.createdAt.toISOString(),
  }));

  return (
    <div>
      <div className="toolbar">
        <h1>Админка: пользователи</h1>
      </div>
      <p className="muted">
        Все компании и пользователи, зарегистрированные в системе — видно только владельцу сервиса.
      </p>
      <AdminUsersTable rows={rows} currentUserEmail={session.user?.email ?? ""} />
    </div>
  );
}
