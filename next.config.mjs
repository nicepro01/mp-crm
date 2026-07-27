/** @type {import('next').NextConfig} */
const nextConfig = {
  // Без этого клиентский Router Cache может показать старые данные на
  // динамических страницах (напр. план поставок) при переходе по ссылке
  // из другого места приложения, даже если на сервере стоит force-dynamic.
  experimental: {
    staleTimes: {
      dynamic: 0,
    },
    // Нужно для instrumentation.ts (фоновый автосинк сезонности) на
    // некоторых версиях Next 14 — в новых уже стабильно и просто игнорируется.
    instrumentationHook: true,
  },
};

export default nextConfig;
