export interface PublicQuestion {
  id: string;
  mode: "quiz" | "fill";
  level: string;
  topic: string;
  prompt: string;
  options: string[];
}

export interface AnswerResult {
  correct: boolean;
  correctIndex: number;
  rule: string;
  why: string | null;
  examples: string[];
}

export async function fetchQuestions(count = 5): Promise<PublicQuestion[]> {
  const res = await fetch(`/api/questions/sample?count=${count}`);
  if (!res.ok) throw new Error("No se pudieron cargar las preguntas");
  return res.json();
}

export async function sendAnswer(questionId: string, choice: number): Promise<AnswerResult> {
  const res = await fetch("/api/answers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, choice }),
  });
  if (!res.ok) throw new Error("No se pudo enviar la respuesta");
  return res.json();
}

export interface User {
  id: string;
  email: string | null;
  displayName: string;
}

async function authRequest(path: string, body?: object): Promise<User> {
  const res = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "No se pudo conectar. Inténtalo de nuevo.");
  return data.user;
}

export const register = (email: string, password: string, displayName: string) =>
  authRequest("register", { email, password, displayName });

export const login = (email: string, password: string) => authRequest("login", { email, password });

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function deleteAccount(): Promise<void> {
  const res = await fetch("/api/auth/me", { method: "DELETE" });
  if (!res.ok && res.status !== 401) throw new Error("No se pudo borrar la cuenta. Inténtalo de nuevo.");
}

/** Usuario con sesión iniciada, o null. */
export async function fetchMe(): Promise<User | null> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return null;
  return (await res.json()).user;
}

export interface Providers {
  google: boolean;
  facebook: boolean;
}

/** Proveedores externos configurados en el servidor. Sin respuesta, ninguno. */
export async function fetchProviders(): Promise<Providers> {
  const res = await fetch("/api/auth/providers").catch(() => null);
  return res?.ok ? res.json() : { google: false, facebook: false };
}

const OAUTH_ERRORS: Record<string, string> = {
  cancelled: "Cancelaste el inicio de sesión. Puedes intentarlo otra vez cuando quieras.",
  email_taken: "Ya tienes una cuenta con ese correo. Entra con tu correo y contraseña.",
  failed: "No se pudo iniciar sesión. Inténtalo de nuevo.",
};

/** Lee y quita de la URL el error con el que vuelve un inicio de sesión con Google o Facebook. */
export function takeOAuthError(): string | undefined {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("auth_error");
  if (!code) return undefined;
  url.searchParams.delete("auth_error");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return OAUTH_ERRORS[code] ?? OAUTH_ERRORS.failed;
}
