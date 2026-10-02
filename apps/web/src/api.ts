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

/** Usuario con sesión iniciada, o null. */
export async function fetchMe(): Promise<User | null> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return null;
  return (await res.json()).user;
}
