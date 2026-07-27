import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";

// Частичное обновление — перетаскивание карточки шлёт только columnId+order
// (см. TaskBoard.tsx), редактирование через карточку шлёт title/description/
// dueDate. Одна ручка на оба случая, чтобы не заводить отдельный "move".
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => PUTContent(req, { params }));
}

async function PUTContent(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const data = await req.json();

  try {
    const task = await prisma.task.update({
      where: { id: params.id },
      data: {
        ...(data.title !== undefined ? { title: String(data.title).trim() } : {}),
        ...(data.description !== undefined ? { description: data.description || null } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
        ...(data.assignee !== undefined ? { assignee: data.assignee || null } : {}),
        ...(data.columnId !== undefined ? { columnId: data.columnId } : {}),
        ...(data.order !== undefined ? { order: Number(data.order) } : {}),
      },
    });
    return NextResponse.json(task);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить карточку" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => DELETEContent(_req, { params }));
}

async function DELETEContent(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.task.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось удалить карточку" },
      { status: 400 }
    );
  }
}
