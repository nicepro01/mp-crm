import { PrismaClient } from "@prisma/client";
import { getCurrentCompanyId } from "./tenantContext";

// Модели, которые сознательно НЕ фильтруются по companyId:
// - Company — сама единица изоляции, нечего фильтровать "по компании".
// - User — поиск при логине идёт по email ГЛОБАЛЬНО (companyId ещё не
//   известен, это и есть то, что логин должен определить) — самой курицы-
//   и-яйца проблемы нет только если User не участвует в автофильтрации;
//   там, где реально нужен список "пользователи ЭТОЙ компании" (напр.
//   будущая страница участников), companyId дописывается в where вручную,
//   это один вызов, а не десятки.
// - PasswordResetToken — используется в /api/forgot-password и
//   /api/reset-password, где сессии (и значит tenant-контекста) ещё нет
//   вообще — токен ищется по самому себе, глобально. У модели и в схеме
//   нет поля companyId, изоляция ей не нужна (она уже привязана к userId).
// Любая ДРУГАЯ модель обязана иметь companyId в схеме — если появится новая
// модель без него, обращение к ней упадёт с понятной ошибкой (см.
// getCurrentCompanyId), а не молча вернёт данные без фильтрации.
const UNSCOPED_MODELS = new Set(["Company", "User", "PasswordResetToken"]);

const READ_UPDATE_DELETE_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

// Prisma Client Extension — на каждый вызов prisma.<model>.<operation>(...)
// домешивает companyId текущей компании (из AsyncLocalStorage, см.
// lib/tenantContext.ts) в where (чтение/обновление/удаление) или в data
// (создание) — САМИ вызовы в ~80 файлах приложения не меняются, изоляция
// между компаниями включается здесь одним универсальным механизмом.
// $queryRaw/$executeRaw эту обёртку не проходят — companyId туда нужно
// добавлять вручную в тех немногих местах, где они используются.
function createExtendedClient() {
  const base = new PrismaClient();
  return base.$extends({
    name: "tenant-scoping",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || UNSCOPED_MODELS.has(model)) {
            return query(args);
          }

          const companyId = getCurrentCompanyId();
          const a = args as Record<string, unknown>;

          if (READ_UPDATE_DELETE_OPERATIONS.has(operation)) {
            a.where = { ...((a.where as object) ?? {}), companyId };
          } else if (operation === "create") {
            a.data = { ...((a.data as object) ?? {}), companyId };
          } else if (operation === "createMany" || operation === "createManyAndReturn") {
            const data = a.data;
            a.data = Array.isArray(data)
              ? data.map((row: object) => ({ ...row, companyId }))
              : { ...((data as object) ?? {}), companyId };
          } else if (operation === "upsert") {
            a.where = { ...((a.where as object) ?? {}), companyId };
            a.create = { ...((a.create as object) ?? {}), companyId };
          }

          return query(a);
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createExtendedClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
