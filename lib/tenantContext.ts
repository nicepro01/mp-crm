import { AsyncLocalStorage } from "node:async_hooks";

type TenantStore = { companyId: string; userId: string };

// На globalThis — тем же приёмом, что и Prisma-синглтон в lib/prisma.ts:
// Next.js в dev-режиме может скомпилировать этот модуль в несколько разных
// чанков (RSC-слой, route handler'ы и т.д.), и без общего globalThis каждый
// получил бы СВОЙ экземпляр AsyncLocalStorage — тогда runWithTenant писал бы
// в один, а getCurrentCompanyId читал бы из другого, всегда получая "нет
// контекста".
const globalForTenant = globalThis as unknown as {
  tenantStorage: AsyncLocalStorage<TenantStore> | undefined;
};

const storage = globalForTenant.tenantStorage ?? new AsyncLocalStorage<TenantStore>();
globalForTenant.tenantStorage = storage;

// Каждый page.tsx/route.ts оборачивает своё тело в runWithTenant(session, fn)
// сразу после получения сессии — дальше по цепочке await ничего руками не
// передаётся: расширенный Prisma-клиент (см. lib/prisma.ts) сам читает
// текущую компанию отсюда и подмешивает её в каждый запрос.
export function runWithTenant<T>(store: TenantStore, fn: () => Promise<T>): Promise<T> {
  return storage.run(store, fn);
}

export function getCurrentCompanyId(): string {
  const store = storage.getStore();
  if (!store) {
    throw new Error(
      "Нет контекста компании — обработчик страницы/API должен вызывать runWithTenant() сразу после получения сессии, до любых обращений к prisma"
    );
  }
  return store.companyId;
}

export function getCurrentUserId(): string {
  const store = storage.getStore();
  if (!store) {
    throw new Error("Нет контекста компании — см. getCurrentCompanyId()");
  }
  return store.userId;
}
