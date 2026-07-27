import ForgotPasswordForm from "./ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <div style={{ maxWidth: 420, margin: "60px auto" }}>
      <h1>Восстановление пароля</h1>
      <p className="muted">Укажите email — если аккаунт есть, придёт письмо со ссылкой.</p>
      <ForgotPasswordForm />
    </div>
  );
}
