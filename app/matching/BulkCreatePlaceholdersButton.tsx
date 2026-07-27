"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function BulkCreatePlaceholdersButton({ count }: { count: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (
      !confirm(
        `Создать ${count} товаров-заглушек? Вес и габариты коробки будут выставлены в 1 — их обязательно нужно будет поправить у каждого товара вручную. SKU и название возьмутся из площадки.`
      )
    ) {
      return;
    }

    setRunning(true);
    setError(null);

    const res = await fetch("/api/matching/bulk-create-placeholders", { method: "POST" });
    setRunning(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка");
      return;
    }

    const body = await res.json();
    if (body.errors?.length) {
      alert(
        `Создано ${body.created} из ${body.total}. Ошибки:\n${body.errors.join("\n")}`
      );
    }
    router.refresh();
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleClick}
        disabled={running}
      >
        {running ? "Создаю…" : `Создать все как товары-заглушки (${count})`}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
