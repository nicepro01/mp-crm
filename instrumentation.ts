// Раньше здесь был фоновый setInterval-автосинк сезонности — сломан для
// serverless/мультитенантности: читал глобальные process.env-токены (их
// больше нет, credentials теперь per-company в Marketplace.credentials) и
// никогда не вызывался внутри runWithTenant(), поэтому падал с "Нет
// контекста компании" при каждом обращении к prisma. Заменено на настоящий
// ежедневный автосинк через Vercel Cron (см. vercel.json,
// app/api/cron/{wb,ozon,yandex}/route.ts) — тот корректно перебирает ВСЕ
// компании и оборачивает каждую в свой tenant-контекст.
export async function register() {}
