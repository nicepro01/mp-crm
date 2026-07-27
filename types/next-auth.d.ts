import { DefaultSession } from "next-auth";

// Расширяем стандартные типы Auth.js своими полями — companyId нужен везде,
// где читается сессия (см. lib/session.ts), чтобы обернуть страницу/роут в
// runWithTenant без приведения через any.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      companyId: string;
    } & DefaultSession["user"];
  }

  interface User {
    companyId: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    companyId: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    companyId: string;
  }
}
