"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  email: string;
  name: string | null;
  companyName: string;
  approved: boolean;
  createdAt: string;
};

export default function AdminUsersTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);

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

  return (
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Имя</th>
          <th>Компания</th>
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
            <td>{r.companyName}</td>
            <td>{new Date(r.createdAt).toLocaleString("ru-RU")}</td>
            <td>
              {r.approved ? (
                <span className="margin-positive">Одобрен</span>
              ) : (
                <span className="margin-negative">Ждёт одобрения</span>
              )}
            </td>
            <td>
              {!r.approved && (
                <button type="button" className="btn" disabled={savingId === r.id} onClick={() => handleApprove(r.id)}>
                  {savingId === r.id ? "…" : "Одобрить"}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
