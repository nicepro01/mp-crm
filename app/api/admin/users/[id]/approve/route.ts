import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isSuperAdminEmail } from "@/lib/superadmin";

export async function PUT(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!isSuperAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 403 });
  }

  try {
    // User — вне автофильтрации companyId, обычный update без runWithTenant.
    const user = await prisma.user.update({
      where: { id: params.id },
      data: { approved: true, approvedAt: new Date() },
    });
    return NextResponse.json(user);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Не удалось одобрить" }, { status: 400 });
  }
}
