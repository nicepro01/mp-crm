"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const result = await signIn("credentials", { email, password, redirect: false });
    setSaving(false);

    if (result?.error) {
      setError("Неверный email или пароль");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Пароль
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>

      {error && <div className="error">{error}</div>}

      <div className="actions">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Входим…" : "Войти"}
        </button>
      </div>
      <p className="muted">
        Ещё нет компании? <a href="/signup">Зарегистрировать</a>
      </p>
    </form>
  );
}
