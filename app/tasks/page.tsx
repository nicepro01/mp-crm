import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import TaskBoard from "./TaskBoard";

export const dynamic = "force-dynamic";

const DEFAULT_COLUMN_TITLES = ["Сделать", "В работе", "Готово"];

// Одна доска на всю компанию — при первом заходе, пока колонок ещё нет,
// создаём 3 стандартные (как в новой доске Trello), дальше пользователь уже
// сам добавляет/переименовывает/удаляет колонки как нужно.
async function getOrSeedColumns() {
  const existing = await prisma.taskColumn.count();
  if (existing === 0) {
    const companyId = getCurrentCompanyId();
    await prisma.taskColumn.createMany({
      data: DEFAULT_COLUMN_TITLES.map((title, i) => ({ companyId, title, order: (i + 1) * 1024 })),
    });
  }
  return prisma.taskColumn.findMany({
    orderBy: { order: "asc" },
    include: {
      tasks: {
        orderBy: { order: "asc" },
        include: { attachments: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
}

export default async function TasksPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => TasksPageContent());
}

async function TasksPageContent() {
  const columns = await getOrSeedColumns();

  const initialColumns = columns.map((c) => ({
    id: c.id,
    title: c.title,
    order: c.order,
    tasks: c.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      assignee: t.assignee,
      order: t.order,
      attachments: t.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        url: a.url,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
      })),
    })),
  }));

  return (
    <div>
      <div className="toolbar">
        <h1>Задачи</h1>
      </div>
      <TaskBoard initialColumns={initialColumns} />
    </div>
  );
}
