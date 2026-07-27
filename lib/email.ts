import { Resend } from "resend";

// Один общий адрес отправителя. onboarding@resend.dev — тестовый домен
// Resend, работает без верификации, но реально доставляет письма ТОЛЬКО на
// почту владельца Resend-аккаунта. Чтобы слать реальным пользователям —
// нужно верифицировать свой домен в Resend и заменить FROM_EMAIL здесь.
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "MP-CRM <onboarding@resend.dev>";

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY не задан — письма отправлять некуда");
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
  if (error) {
    throw new Error(`Resend: ${error.message}`);
  }
}
