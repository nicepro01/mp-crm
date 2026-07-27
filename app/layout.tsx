import type { Metadata } from "next";
import "./globals.css";
import ThemeToggle from "./ThemeToggle";

export const metadata: Metadata = {
  title: "MP-CRM",
  description: "CRM для товарного бизнеса (WB / Ozon / Яндекс.Маркет + B2B)",
};

// Ставим тему ДО первой отрисовки, синхронным инлайн-скриптом — иначе на
// долю секунды мелькнёт тема по умолчанию, пока не подгрузился React.
// По умолчанию (нет сохранённого выбора) — тёмная тема.
const setThemeScript = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var theme = stored === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <head>
        <script dangerouslySetInnerHTML={{ __html: setThemeScript }} />
      </head>
      <body>
        <nav>
          <a href="/">MP-CRM</a>
          <a href="/products">Товары</a>
          <a href="/suppliers">Поставщики</a>
          <a href="/batches">Поставки</a>
          <a href="/stock">Остатки</a>
          <a href="/analytics">Аналитика</a>
          <a href="/unit-economics">Юнит-экономика</a>
          <a href="/returns">Возвраты</a>
          <a href="/tasks">Задачи</a>
          <a href="/settings/integrations">Интеграции</a>
          <span className="nav-spacer" />
          <ThemeToggle />
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
