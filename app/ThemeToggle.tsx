"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  // Реальное значение уже выставлено инлайн-скриптом в <head> до первой
  // отрисовки — здесь просто читаем его, чтобы кнопка сразу показывала
  // правильную иконку без мигания.
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title="Переключить тему"
    >
      {theme === "dark" ? "☀️ Светлая" : "🌙 Тёмная"}
    </button>
  );
}
