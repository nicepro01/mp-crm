"use client";

import { useState } from "react";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = await fetch("/api/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Не удалось отправить письмо");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return <p className="muted">Если такой email зарегистрирован — письмо со ссылкой уже отправлено.</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Отправляем…" : "Отправить ссылку"}
        </button>
      </div>
      <p className="muted">
        Вспомнили пароль? <a href="/login">Войти</a>
      </p>
    </form>
  );
}
