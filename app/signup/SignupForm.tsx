"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Не удалось зарегистрироваться");
      setSaving(false);
      return;
    }

    const signInResult = await signIn("credentials", { email, password, redirect: false });
    setSaving(false);

    if (signInResult?.error) {
      setError("Компания создана, но вход не удался — попробуйте войти вручную");
      router.push("/login");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Ваше имя (необязательно)
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Пароль
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
          {saving ? "Регистрируем…" : "Зарегистрироваться"}
        </button>
      </div>
      <p className="muted">
        Уже есть аккаунт? <a href="/login">Войти</a>
      </p>
    </form>
  );
}
