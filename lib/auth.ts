import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";

// Полный конфиг (с Credentials-провайдером, который обращается к Prisma) —
// используется в API route handler'е и на сервере (server components,
// route.ts), НЕ в middleware.ts (тот использует облегчённый authConfig без
// providers, см. lib/auth.config.ts — Prisma Client не работает в Edge
// Runtime, где выполняется middleware).
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Пароль", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        // User — модель без companyId-скоупинга в extension (см.
        // UNSCOPED_MODELS в lib/prisma.ts) — поиск по email идёт глобально,
        // компания ещё не известна, это и есть то, что логин определяет.
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          companyId: user.companyId,
        };
      },
    }),
  ],
});
