import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isSuperAdminEmail } from "@/lib/superadmin";

// Регистрация новой компании — создаёт Company + первого User атомарно.
// Этот пользователь не получает больше прав, чем остальные сотрудники той
// же компании (ролей внутри компании нет) — он просто первый.
export async function POST(req: NextRequest) {
  const data = await req.json();
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const password = typeof data.password === "string" ? data.password : "";
  const name = typeof data.name === "string" ? data.name.trim() : null;
  // Название компании в форме регистрации не спрашиваем — просто заводим
  // рабочее имя (по имени пользователя или email), при желании его можно
  // переименовать позже в настройках.
  const companyName = name ? `Компания ${name}` : `Компания ${email.split("@")[0]}`;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Укажите корректный email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Пароль должен быть не короче 8 символов" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Пользователь с таким email уже зарегистрирован" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    // User и Company — обе модели вне автофильтрации companyId (см.
    // UNSCOPED_MODELS в lib/prisma.ts), поэтому create здесь идёт без
    // runWithTenant — контекста ещё и не может быть, это же и есть
    // создание первой компании.
    // Владельца всего сервиса (см. SUPERADMIN_EMAILS) одобрять некому —
    // остальные ждут ручного подтверждения в /admin.
    const approved = isSuperAdminEmail(email);
    await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: companyName } });
      await tx.user.create({
        data: { email, passwordHash, name, companyId: company.id, approved, approvedAt: approved ? new Date() : null },
      });
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Не удалось зарегистрировать компанию" }, { status: 400 });
  }
}
