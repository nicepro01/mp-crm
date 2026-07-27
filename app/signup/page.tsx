import SignupForm from "./SignupForm";

export default function SignupPage() {
  return (
    <div style={{ maxWidth: 420, margin: "60px auto" }}>
      <h1>Регистрация</h1>
      <p className="muted">
        Регистрация для сотрудников компании — после одобрения администратором
        вы получите доступ к общим товарам, поставкам, аналитике и задачам.
      </p>
      <SignupForm />
    </div>
  );
}
