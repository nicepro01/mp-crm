import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  if (!data.columnId) {
    return NextResponse.json({ error: "Не указана колонка" }, { status: 400 });
  }
  if (!data.title || !String(data.title).trim()) {
    return NextResponse.json({ error: "Укажите название карточки" }, { status: 400 });
  }

  try {
    const last = await prisma.task.findFirst({
      where: { columnId: data.columnId },
      orderBy: { order: "desc" },
    });
    const task = await prisma.task.create({
      data: {
        companyId: getCurrentCompanyId(),
        columnId: data.columnId,
        title: String(data.title).trim(),
        description: data.description || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        order: (last?.order ?? 0) + 1024,
      },
    });
    return NextResponse.json(task, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось создать карточку" },
      { status: 400 }
    );
  }
}
