import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { describeError } from "../api/errors";
import { Button, ErrorText, Field, Input } from "../components/ui";

export function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, remember);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-sm">
        <h1 className="text-xl font-bold text-slate-800 mb-1">ИП Царюк А.Б.</h1>
        <p className="text-sm text-slate-500 mb-4">Портал автопарка</p>

        <Field label="Логин">
          <Input type="text" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" />
        </Field>
        <Field label="Пароль">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-600 mt-1 mb-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          Запомнить меня
        </label>

        <Button type="submit" disabled={submitting} className="w-full mt-2">
          {submitting ? "Входим…" : "Войти"}
        </Button>
        <ErrorText>{error}</ErrorText>
      </form>
    </div>
  );
}
