import ResetPasswordForm from "./ResetPasswordForm";

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  return (
    <div style={{ maxWidth: 420, margin: "60px auto" }}>
      <h1>Новый пароль</h1>
      <ResetPasswordForm token={searchParams.token ?? ""} />
    </div>
  );
}
