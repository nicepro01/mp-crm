import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isSuperAdminEmail } from "@/lib/superadmin";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!isSuperAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 403 });
  }

  // Нельзя удалить самого себя через админку — иначе можно случайно
  // остаться без единственного суперадмин-доступа.
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (target?.email === session?.user?.email) {
    return NextResponse.json({ error: "Нельзя удалить собственный аккаунт" }, { status: 400 });
  }

  try {
    await prisma.user.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Не удалось удалить" }, { status: 400 });
  }
}
