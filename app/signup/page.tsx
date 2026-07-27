import SignupForm from "./SignupForm";

export default function SignupPage() {
  return (
    <div style={{ maxWidth: 420, margin: "60px auto" }}>
      <h1>Регистрация компании</h1>
      <p className="muted">
        Создаёт новую компанию с полностью изолированными данными — товары, поставки,
        аналитика и задачи не пересекаются с другими компаниями.
      </p>
      <SignupForm />
    </div>
  );
}
