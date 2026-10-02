import { useEffect, useState, type FormEvent } from "react";
import { fetchProviders, login, register, type Providers, type User } from "./api";

export function AuthForm({
  onDone,
  onCancel,
  initialError,
}: {
  onDone: (user: User) => void;
  onCancel: () => void;
  initialError?: string;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | undefined>(initialError);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<Providers>({ google: false, facebook: false });

  useEffect(() => {
    fetchProviders().then(setProviders);
  }, []);

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
      {(providers.google || providers.facebook) && (
        <div className="social">
          {providers.google && (
            <a className="social-button google" href="/api/auth/google/start">
              <GoogleIcon />
              Continuar con Google
            </a>
          )}
          {providers.facebook && (
            <a className="social-button facebook" href="/api/auth/facebook/start">
              <FacebookIcon />
              Continuar con Facebook
            </a>
          )}
          <p className="divider">o con tu correo</p>
        </div>
      )}
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

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.7 10.8l7.8-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"
      />
    </svg>
  );
}
