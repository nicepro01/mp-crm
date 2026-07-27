"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  email: string;
  name: string | null;
  position: string | null;
  approved: boolean;
  createdAt: string;
};

export default function AdminUsersTable({
  rows,
  currentUserEmail,
}: {
  rows: Row[];
  currentUserEmail: string;
}) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.id, r.position ?? ""]))
  );

  async function handleApprove(id: string) {
    setSavingId(id);
    const res = await fetch(`/api/admin/users/${id}/approve`, { method: "PUT" });
    setSavingId(null);
    if (!res.ok) {
      alert("Не удалось одобрить");
      return;
    }
    router.refresh();
  }

  async function handleSavePosition(id: string) {
    setSavingId(id);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: positions[id] ?? "" }),
    });
    setSavingId(null);
    if (!res.ok) {
      alert("Не удалось сохранить должность");
      return;
    }
    router.refresh();
  }

  async function handleDelete(id: string, confirmText: string) {
    if (!confirm(confirmText)) return;
    setSavingId(id);
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    setSavingId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Не удалось удалить");
      return;
    }
    router.refresh();
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Имя</th>
          <th>Должность</th>
          <th>Зарегистрирован</th>
          <th>Статус</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.email}</td>
            <td>{r.name ?? "—"}</td>
            <td>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={positions[r.id] ?? ""}
                  onChange={(e) => setPositions((p) => ({ ...p, [r.id]: e.target.value }))}
                  placeholder="Не указана"
                  style={{ width: 140 }}
                />
                {positions[r.id] !== (r.position ?? "") && (
                  <button
                    type="button"
                    className="btn"
                    disabled={savingId === r.id}
                    onClick={() => handleSavePosition(r.id)}
                  >
                    {savingId === r.id ? "…" : "Сохранить"}
                  </button>
                )}
              </div>
            </td>
            <td>{new Date(r.createdAt).toLocaleString("ru-RU")}</td>
            <td>
              {r.approved ? (
                <span className="margin-positive">Одобрен</span>
              ) : (
                <span className="margin-negative">Ждёт одобрения</span>
              )}
            </td>
            <td>
              {r.email === currentUserEmail ? (
                <span className="muted">Это вы</span>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  {!r.approved && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        disabled={savingId === r.id}
                        onClick={() => handleApprove(r.id)}
                      >
                        {savingId === r.id ? "…" : "Одобрить"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={savingId === r.id}
                        onClick={() =>
                          handleDelete(
                            r.id,
                            `Отклонить регистрацию ${r.email}? Аккаунт будет удалён без возможности восстановления.`
                          )
                        }
                      >
                        {savingId === r.id ? "…" : "Отклонить"}
                      </button>
                    </>
                  )}
                  {r.approved && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={savingId === r.id}
                      onClick={() =>
                        handleDelete(
                          r.id,
                          `Удалить аккаунт ${r.email}? Пользователь потеряет доступ к системе. Отменить это действие нельзя.`
                        )
                      }
                    >
                      {savingId === r.id ? "…" : "Удалить"}
                    </button>
                  )}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
