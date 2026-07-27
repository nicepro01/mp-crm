import type { NextAuthConfig } from "next-auth";

// Часть конфига, безопасная для Edge Runtime (её использует middleware.ts,
// а Prisma Client там работать не может в принципе) — без providers
// (Credentials-провайдер с обращением к Prisma живёт только в lib/auth.ts).
// JWT-сессии как раз для этого и годятся: middleware проверяет ТОЛЬКО
// валидность подписи токена, к базе вообще не обращаясь.
export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id!;
        token.companyId = user.companyId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId;
      session.user.companyId = token.companyId;
      return session;
    },
  },
};
