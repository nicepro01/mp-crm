import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 час

export async function POST(req: NextRequest) {
  const data = await req.json();
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";

  // Не выдаём, существует ли email в системе — всегда один и тот же ответ,
  // иначе форма становится инструментом проверки чужих email на регистрацию.
  const genericResponse = NextResponse.json({
    ok: true,
    message: "Если такой email зарегистрирован, письмо со ссылкой уже отправлено",
  });

  if (!email) return genericResponse;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return genericResponse;

  const token = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: { token, userId: user.id, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });

  const origin = new URL(req.url).origin;
  const resetUrl = `${origin}/reset-password?token=${token}`;

  try {
    await sendEmail({
      to: email,
      subject: "Восстановление пароля — MP-CRM",
      html: `
        <p>Запрошено восстановление пароля для вашего аккаунта в MP-CRM.</p>
        <p><a href="${resetUrl}">Придумать новый пароль</a></p>
        <p>Ссылка действует 1 час. Если вы не запрашивали восстановление — просто проигнорируйте это письмо.</p>
      `,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Не удалось отправить письмо" }, { status: 500 });
  }

  return genericResponse;
}
