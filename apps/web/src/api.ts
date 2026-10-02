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

export type LevelGroup = "basico" | "intermedio" | "avanzado" | "todos";

export const LEVEL_GROUPS: { id: LevelGroup; name: string; levels: string }[] = [
  { id: "basico", name: "Básico", levels: "A1 – A2" },
  { id: "intermedio", name: "Intermedio", levels: "B1 – B2" },
  { id: "avanzado", name: "Avanzado", levels: "C1 – C2" },
  { id: "todos", name: "Todos los niveles", levels: "A1 – C2, mezclados" },
];

export type GameMode = "mezcla" | "quiz" | "fill";

/** Modos de juego del menú principal; los que no tienen `id` aún no se pueden jugar. */
export const GAME_MODES: { id?: GameMode; name: string; description: string }[] = [
  { id: "quiz", name: "Quiz relámpago", description: "Elige la respuesta correcta" },
  { id: "fill", name: "Completa la frase", description: "Encuentra la palabra que falta" },
  { id: "mezcla", name: "Partida mixta", description: "Preguntas de todo tipo" },
  { name: "Phrasal Verb Builder", description: "Une verbo y partícula" },
  { name: "Idiom Match", description: "Empareja cada idiom con su significado" },
  { name: "Corrige el error", description: "Encuentra la palabra incorrecta" },
  { name: "Ordena la frase", description: "Pon las palabras en orden" },
  { name: "Escucha y escribe", description: "Dictado en inglés" },
  { name: "Supervivencia", description: "Tres vidas y dificultad creciente" },
];

/** Número de preguntas de cada grupo de niveles. */
export async function fetchLevelCounts(): Promise<Record<LevelGroup, number>> {
  const res = await fetch("/api/levels");
  if (!res.ok) throw new Error("No se pudieron cargar los niveles");
  return res.json();
}

export async function fetchQuestions(mode: GameMode, group: LevelGroup, count = 5): Promise<PublicQuestion[]> {
  const modeParam = mode === "mezcla" ? "" : `&mode=${mode}`;
  const res = await fetch(`/api/questions/sample?count=${count}&group=${group}${modeParam}`);
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
  /** Formas de entrar (`password`, `google`, `facebook`); solo viene en `fetchMe`. */
  providers?: string[];
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

export const PROVIDER_NAMES: Record<string, string> = {
  password: "Correo y contraseña",
  google: "Google",
  facebook: "Facebook",
};

const OAUTH_ERRORS: Record<string, string> = {
  cancelled: "Cancelaste el inicio de sesión. Puedes intentarlo otra vez cuando quieras.",
  email_taken:
    "Ya tienes una cuenta con ese correo. Entra con tu correo y contraseña, pulsa tu nombre y vincula Google o Facebook desde ahí.",
  in_use: "Esa cuenta ya está vinculada a otra cuenta del juego.",
  failed: "No se pudo completar. Inténtalo de nuevo.",
};

export type AuthResult =
  | { kind: "error"; code: string; message: string }
  | { kind: "linked"; message: string };

/** Lee y quita de la URL el resultado con el que se vuelve de Google o Facebook. */
export function takeAuthResult(): AuthResult | undefined {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("auth_error");
  const linked = url.searchParams.get("linked");
  if (!code && !linked) return undefined;
  url.searchParams.delete("auth_error");
  url.searchParams.delete("linked");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  if (code) return { kind: "error", code, message: OAUTH_ERRORS[code] ?? OAUTH_ERRORS.failed };
  return { kind: "linked", message: `${PROVIDER_NAMES[linked!] ?? "La cuenta"} quedó vinculado. Ya puedes entrar con él.` };
}
