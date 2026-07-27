"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type AttachmentItem = {
  id: string;
  fileName: string;
  url: string;
  fileSize: number;
  mimeType: string;
};
export type TaskItem = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  assignee: string | null;
  order: number;
  attachments: AttachmentItem[];
};
export type ColumnData = {
  id: string;
  title: string;
  order: number;
  tasks: TaskItem[];
};

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

// order — Float, вставка между двумя соседями — среднее их order, вставка в
// начало/конец — половина первого / +1024 к последнему. Не нужно
// перенумеровывать все остальные строки при каждой перестановке.
function orderBetween(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 1024;
  if (prev === undefined) return next! / 2;
  if (next === undefined) return prev + 1024;
  return (prev + next) / 2;
}

function fmtDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

// Как в Trello: перетаскивание карточек между колонками и внутри колонки,
// перетаскивание самих колонок (за заголовок), клик по карточке открывает
// детали (название/описание/срок) в модалке. Нативный HTML5 drag-and-drop —
// без новой зависимости, тот же подход, что и с самописными графиками
// вместо готовой библиотеки (см. MiniChart.tsx).
export default function TaskBoard({ initialColumns }: { initialColumns: ColumnData[] }) {
  const router = useRouter();
  const [columns, setColumns] = useState<ColumnData[]>(initialColumns);

  const [draggingTask, setDraggingTask] = useState<{ id: string; fromColumnId: string } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ columnId: string; index: number } | null>(null);
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
  const [columnDropIndex, setColumnDropIndex] = useState<number | null>(null);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [addingTaskColumnId, setAddingTaskColumnId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingColumnTitle, setEditingColumnTitle] = useState("");

  function handleTaskDragOver(e: React.DragEvent<HTMLDivElement>, columnId: string, index: number) {
    if (!draggingTask) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const isBelow = e.clientY > rect.top + rect.height / 2;
    setDropIndicator({ columnId, index: isBelow ? index + 1 : index });
  }

  function handleColumnBodyDragOver(e: React.DragEvent<HTMLDivElement>, columnId: string, taskCount: number) {
    if (!draggingTask) return;
    e.preventDefault();
    setDropIndicator({ columnId, index: taskCount });
  }

  async function finalizeTaskDrop() {
    if (!draggingTask || !dropIndicator) {
      setDraggingTask(null);
      setDropIndicator(null);
      return;
    }
    const { id: taskId, fromColumnId } = draggingTask;
    const { columnId: toColumnId, index } = dropIndicator;
    let newOrder = 0;

    setColumns((prev) => {
      const next = prev.map((c) => ({ ...c, tasks: [...c.tasks] }));
      const fromCol = next.find((c) => c.id === fromColumnId)!;
      const taskIndex = fromCol.tasks.findIndex((t) => t.id === taskId);
      const [task] = fromCol.tasks.splice(taskIndex, 1);
      const toCol = next.find((c) => c.id === toColumnId)!;
      // Внутри той же колонки: после splice всё, что было ПОСЛЕ убранной
      // карточки, сдвинулось на 1 индекс назад.
      let insertIndex = fromColumnId === toColumnId && taskIndex < index ? index - 1 : index;
      insertIndex = Math.max(0, Math.min(insertIndex, toCol.tasks.length));
      const prevTask = toCol.tasks[insertIndex - 1];
      const nextTask = toCol.tasks[insertIndex];
      newOrder = orderBetween(prevTask?.order, nextTask?.order);
      toCol.tasks.splice(insertIndex, 0, { ...task, order: newOrder });
      return next;
    });

    setDraggingTask(null);
    setDropIndicator(null);

    await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId: toColumnId, order: newOrder }),
    });
    router.refresh();
  }

  async function finalizeColumnDrop() {
    if (!draggingColumnId || columnDropIndex === null) {
      setDraggingColumnId(null);
      setColumnDropIndex(null);
      return;
    }
    const columnId = draggingColumnId;
    const dropIndex = columnDropIndex;
    let newOrder = 0;

    setColumns((prev) => {
      const next = [...prev];
      const fromIndex = next.findIndex((c) => c.id === columnId);
      const [col] = next.splice(fromIndex, 1);
      const insertIndex = fromIndex < dropIndex ? dropIndex - 1 : dropIndex;
      const prevCol = next[insertIndex - 1];
      const nextCol = next[insertIndex];
      newOrder = orderBetween(prevCol?.order, nextCol?.order);
      next.splice(insertIndex, 0, { ...col, order: newOrder });
      return next;
    });

    setDraggingColumnId(null);
    setColumnDropIndex(null);

    await fetch(`/api/task-columns/${columnId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: newOrder }),
    });
    router.refresh();
  }

  async function handleAddTask(columnId: string) {
    const title = newTaskTitle.trim();
    if (!title) return;
    setNewTaskTitle("");
    setAddingTaskColumnId(null);

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId, title }),
    });
    if (res.ok) {
      const task = await res.json();
      setColumns((prev) =>
        prev.map((c) =>
          c.id === columnId
            ? {
                ...c,
                tasks: [
                  ...c.tasks,
                  {
                    id: task.id,
                    title: task.title,
                    description: task.description,
                    dueDate: task.dueDate,
                    assignee: task.assignee ?? null,
                    order: task.order,
                    attachments: [],
                  },
                ],
              }
            : c
        )
      );
    }
  }

  async function handleAddColumn() {
    const title = newColumnTitle.trim();
    if (!title) return;
    setNewColumnTitle("");
    setAddingColumn(false);

    const res = await fetch("/api/task-columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const column = await res.json();
      setColumns((prev) => [...prev, { id: column.id, title: column.title, order: column.order, tasks: [] }]);
    }
  }

  async function handleRenameColumn(columnId: string) {
    const title = editingColumnTitle.trim();
    setEditingColumnId(null);
    if (!title) return;
    setColumns((prev) => prev.map((c) => (c.id === columnId ? { ...c, title } : c)));
    await fetch(`/api/task-columns/${columnId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }

  async function handleDeleteColumn(columnId: string) {
    if (!confirm("Удалить колонку и все задачи в ней?")) return;
    setColumns((prev) => prev.filter((c) => c.id !== columnId));
    await fetch(`/api/task-columns/${columnId}`, { method: "DELETE" });
    router.refresh();
  }

  async function handleSaveTask(
    taskId: string,
    patch: { title: string; description: string | null; dueDate: string | null; assignee: string | null }
  ) {
    setColumns((prev) => prev.map((c) => ({ ...c, tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) })));
    setOpenTaskId(null);
    await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    router.refresh();
  }

  async function handleDeleteTask(taskId: string) {
    if (!confirm("Удалить карточку?")) return;
    setColumns((prev) => prev.map((c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== taskId) })));
    setOpenTaskId(null);
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    router.refresh();
  }

  // Вложения — отдельные записи, действуют сразу (не ждут кнопки
  // "Сохранить" у остальных полей карточки), т.к. это, по сути, отдельный
  // список, а не одно редактируемое поле.
  async function handleUploadAttachment(taskId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Не удалось загрузить вложение");
      return;
    }
    const attachment = await res.json();
    setColumns((prev) =>
      prev.map((c) => ({
        ...c,
        tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, attachments: [...t.attachments, attachment] } : t)),
      }))
    );
  }

  async function handleDeleteAttachment(taskId: string, attachmentId: string) {
    setColumns((prev) =>
      prev.map((c) => ({
        ...c,
        tasks: c.tasks.map((t) =>
          t.id === taskId ? { ...t, attachments: t.attachments.filter((a) => a.id !== attachmentId) } : t
        ),
      }))
    );
    await fetch(`/api/task-attachments/${attachmentId}`, { method: "DELETE" });
  }

  const openTask = openTaskId ? columns.flatMap((c) => c.tasks).find((t) => t.id === openTaskId) ?? null : null;
  const knownAssignees = [...new Set(columns.flatMap((c) => c.tasks).map((t) => t.assignee).filter((a): a is string => Boolean(a)))];

  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", overflowX: "auto", paddingBottom: 12 }}>
        {columns.map((col, colIndex) => (
          <div
            key={col.id}
            className="task-column"
            onDragOver={(e) => {
              if (draggingColumnId) {
                e.preventDefault();
                setColumnDropIndex(colIndex);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingColumnId) finalizeColumnDrop();
            }}
          >
            {draggingColumnId && draggingColumnId !== col.id && columnDropIndex === colIndex && (
              <div style={{ height: 4, background: "var(--link)", borderRadius: 2, margin: "0 8px 4px" }} />
            )}
            <div
              className="task-column-header"
              draggable
              onDragStart={() => setDraggingColumnId(col.id)}
              onDragEnd={() => {
                setDraggingColumnId(null);
                setColumnDropIndex(null);
              }}
            >
              {editingColumnId === col.id ? (
                <input
                  autoFocus
                  value={editingColumnTitle}
                  onChange={(e) => setEditingColumnTitle(e.target.value)}
                  onBlur={() => handleRenameColumn(col.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingColumnId(null);
                  }}
                  style={{ flex: 1, fontSize: 14, fontWeight: 600 }}
                />
              ) : (
                <strong
                  style={{ flex: 1, cursor: "text" }}
                  onClick={() => {
                    setEditingColumnId(col.id);
                    setEditingColumnTitle(col.title);
                  }}
                >
                  {col.title} <span className="muted" style={{ fontWeight: 400 }}>({col.tasks.length})</span>
                </strong>
              )}
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                onClick={() => handleDeleteColumn(col.id)}
                title="Удалить колонку"
              >
                ×
              </button>
            </div>

            <div
              className="task-column-body"
              onDragOver={(e) => handleColumnBodyDragOver(e, col.id, col.tasks.length)}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingTask) finalizeTaskDrop();
              }}
            >
              {col.tasks.map((t, i) => (
                <div key={t.id}>
                  {dropIndicator?.columnId === col.id && dropIndicator.index === i && (
                    <div className="task-drop-line" />
                  )}
                  <div
                    className="task-card"
                    draggable
                    onDragStart={() => setDraggingTask({ id: t.id, fromColumnId: col.id })}
                    onDragEnd={() => {
                      setDraggingTask(null);
                      setDropIndicator(null);
                    }}
                    onDragOver={(e) => handleTaskDragOver(e, col.id, i)}
                    onClick={() => setOpenTaskId(t.id)}
                  >
                    <div>{t.title}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                      {t.dueDate && (
                        <span
                          className={`task-due-badge ${new Date(t.dueDate) < new Date() ? "task-due-badge-overdue" : ""}`}
                        >
                          {fmtDueDate(t.dueDate)}
                        </span>
                      )}
                      {t.assignee && <span className="task-due-badge">👤 {t.assignee}</span>}
                      {t.attachments.length > 0 && (
                        <span className="task-due-badge">📎 {t.attachments.length}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {dropIndicator?.columnId === col.id && dropIndicator.index === col.tasks.length && (
                <div className="task-drop-line" />
              )}

              {addingTaskColumnId === col.id ? (
                <div>
                  <textarea
                    autoFocus
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onBlur={() => {
                      if (!newTaskTitle.trim()) setAddingTaskColumnId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleAddTask(col.id);
                      }
                      if (e.key === "Escape") {
                        setAddingTaskColumnId(null);
                        setNewTaskTitle("");
                      }
                    }}
                    rows={2}
                    style={{ width: "100%", resize: "none", marginBottom: 6 }}
                    placeholder="Название карточки…"
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="btn" onClick={() => handleAddTask(col.id)}>
                      Добавить
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setAddingTaskColumnId(null);
                        setNewTaskTitle("");
                      }}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="task-add-btn" onClick={() => setAddingTaskColumnId(col.id)}>
                  + Добавить карточку
                </button>
              )}
            </div>
          </div>
        ))}

        <div style={{ width: 272, flexShrink: 0 }}>
          {addingColumn ? (
            <div className="task-column" style={{ padding: 10 }}>
              <input
                autoFocus
                value={newColumnTitle}
                onChange={(e) => setNewColumnTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddColumn();
                  if (e.key === "Escape") {
                    setAddingColumn(false);
                    setNewColumnTitle("");
                  }
                }}
                placeholder="Название колонки…"
                style={{ width: "100%", marginBottom: 6 }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn" onClick={handleAddColumn}>
                  Добавить
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setAddingColumn(false);
                    setNewColumnTitle("");
                  }}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="task-add-btn"
              onClick={() => setAddingColumn(true)}
              style={{ background: "var(--surface-alt)", borderRadius: 8, padding: 10 }}
            >
              + Добавить колонку
            </button>
          )}
        </div>
      </div>

      {openTask && (
        <TaskDetailModal
          key={openTask.id}
          task={openTask}
          knownAssignees={knownAssignees}
          onClose={() => setOpenTaskId(null)}
          onSave={(patch) => handleSaveTask(openTask.id, patch)}
          onDelete={() => handleDeleteTask(openTask.id)}
          onUploadAttachment={(file) => handleUploadAttachment(openTask.id, file)}
          onDeleteAttachment={(attachmentId) => handleDeleteAttachment(openTask.id, attachmentId)}
        />
      )}
    </>
  );
}

function TaskDetailModal({
  task,
  knownAssignees,
  onClose,
  onSave,
  onDelete,
  onUploadAttachment,
  onDeleteAttachment,
}: {
  task: TaskItem;
  knownAssignees: string[];
  onClose: () => void;
  onSave: (patch: { title: string; description: string | null; dueDate: string | null; assignee: string | null }) => void;
  onDelete: () => void;
  onUploadAttachment: (file: File) => void;
  onDeleteAttachment: (attachmentId: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : "");
  const [assignee, setAssignee] = useState(task.assignee ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function handleSave() {
    onSave({
      title: title.trim() || task.title,
      description: description.trim() || null,
      dueDate: dueDate || null,
      assignee: assignee.trim() || null,
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await onUploadAttachment(file);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="photo-lightbox-backdrop" onClick={onClose}>
      <div className="task-modal" onClick={(e) => e.stopPropagation()}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: "100%", fontSize: 17, fontWeight: 600, marginBottom: 12 }}
        />
        <label style={{ marginBottom: 12 }}>
          Описание
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            style={{ width: "100%", resize: "vertical" }}
          />
        </label>
        <div className="row" style={{ marginBottom: 16, maxWidth: 480 }}>
          <label>
            Срок
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label>
            Ответственный
            <input
              list="task-assignee-options"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Имя…"
            />
            <datalist id="task-assignee-options">
              {knownAssignees.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Вложения</div>
          {task.attachments.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
              {task.attachments.map((a) => (
                <div
                  key={a.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, background: "var(--surface-alt)", borderRadius: 6, padding: "4px 8px" }}
                >
                  <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    📎 {a.fileName}
                  </a>
                  <span className="muted" style={{ whiteSpace: "nowrap" }}>{fmtFileSize(a.fileSize)}</span>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    onClick={() => onDeleteAttachment(a.id)}
                    title="Удалить вложение"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <input type="file" onChange={handleFileChange} disabled={uploading} />
          {uploading && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Загрузка…</p>}
          {uploadError && <p className="error" style={{ marginTop: 4 }}>{uploadError}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <button type="button" className="btn btn-danger" onClick={onDelete}>
            Удалить
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="btn" onClick={handleSave}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
