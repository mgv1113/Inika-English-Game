import { useState, type FormEvent } from "react";
import { login, register, type User } from "./api";

export function AuthForm({ onDone, onCancel }: { onDone: (user: User) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    setError(undefined);
    try {
      const user =
        mode === "login"
          ? await login(email, password)
          : await register(email, password, String(form.get("displayName")));
      onDone(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isLogin = mode === "login";

  return (
    <section className="card">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={isLogin} className={isLogin ? "tab active" : "tab"} onClick={() => setMode("login")}>
          Iniciar sesión
        </button>
        <button role="tab" aria-selected={!isLogin} className={!isLogin ? "tab active" : "tab"} onClick={() => setMode("register")}>
          Crear cuenta
        </button>
      </div>
      <form className="form" onSubmit={submit}>
        {!isLogin && (
          <label>
            Nombre
            <input name="displayName" autoComplete="nickname" required minLength={2} maxLength={40} />
          </label>
        )}
        <label>
          Correo
          <input name="email" type="email" autoComplete="email" required maxLength={254} />
        </label>
        <label>
          Contraseña
          <input
            name="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            minLength={isLogin ? 1 : 8}
            maxLength={128}
          />
        </label>
        {!isLogin && <p className="muted">Mínimo 8 caracteres.</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Un momento…" : isLogin ? "Entrar" : "Crear cuenta"}
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Seguir jugando sin cuenta
        </button>
      </form>
    </section>
  );
}
