"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Кнопки решения по кандидату. POST /api/research/[id] -> router.refresh().
export default function ResearchActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(next: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/research/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Ошибка");
      router.refresh();
    } catch (e: any) {
      setErr(e.message ?? "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const decided = status === "approved" || status === "rejected" || status === "snoozed";

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      {!decided && (
        <>
          <button type="button" className="btn" disabled={busy} onClick={() => set("approved")}>
            В тест
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => set("snoozed")}>
            Отложить
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => set("rejected")}>
            Отклонить
          </button>
        </>
      )}
      {decided && (
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => set("review")}>
          ↩ Вернуть
        </button>
      )}
      {err && <span className="error">{err}</span>}
    </div>
  );
}
