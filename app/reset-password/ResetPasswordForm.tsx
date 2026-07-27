"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!token) {
    return <p className="error">Ссылка недействительна — перейдите по ссылке из письма ещё раз.</p>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = await fetch("/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Не удалось сохранить пароль");
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 1500);
  }

  if (done) {
    return <p className="muted">Пароль обновлён, сейчас перекинем на страницу входа…</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Новый пароль
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </label>
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Сохраняем…" : "Сохранить пароль"}
        </button>
      </div>
    </form>
  );
}
