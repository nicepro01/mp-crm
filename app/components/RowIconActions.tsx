"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function EditIconLink({ href, title = "Изменить" }: { href: string; title?: string }) {
  return (
    <a href={href} className="icon-btn" title={title} aria-label={title}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    </a>
  );
}

// Для инлайн-редактирования прямо в таблице (без перехода на отдельную
// страницу) — переключает строку в режим правки, в отличие от EditIconLink.
export function EditIconButton({ onClick, title = "Изменить" }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    </button>
  );
}

export function SaveIconButton({
  onClick,
  disabled,
  title = "Сохранить",
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </button>
  );
}

export function CancelIconButton({ onClick, title = "Отмена" }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 6L6 18" />
        <path d="M6 6l12 12" />
      </svg>
    </button>
  );
}

export function DeleteIconButton({
  endpoint,
  confirmMessage,
  title = "Удалить",
}: {
  endpoint: string;
  confirmMessage: string;
  title?: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(confirmMessage)) return;
    setDeleting(true);
    const res = await fetch(endpoint, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Не удалось удалить");
    }
  }

  return (
    <button
      type="button"
      className="icon-btn icon-btn-danger"
      onClick={handleDelete}
      disabled={deleting}
      title={title}
      aria-label={title}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    </button>
  );
}
