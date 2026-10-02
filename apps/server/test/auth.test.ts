import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createMemoryAuthStore } from "../src/auth/memory-store.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { createPgAuthStore } from "../src/auth/pg-store.js";
import { OAUTH_COOKIE, SESSION_COOKIE } from "../src/auth/routes.js";
import type { AuthStore } from "../src/auth/store.js";
import { loadQuestions } from "../src/content.js";
import { migrate } from "../src/db/migrate.js";
import { createMemoryRallyStore, createPgRallyStore, type RallyStore } from "../src/rally/store.js";

// Con TEST_DATABASE_URL (CI la define) las mismas pruebas corren también contra PostgreSQL.
const databaseUrl = process.env.TEST_DATABASE_URL;

describe("contraseñas", () => {
  it("verifica la contraseña correcta y rechaza otras", async () => {
    const hash = await hashPassword("correcta-123");
    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain("correcta-123");
    expect(await verifyPassword("correcta-123", hash)).toBe(true);
    expect(await verifyPassword("Correcta-123", hash)).toBe(false);
  });

  it("usa una sal distinta en cada hash", async () => {
    expect(await hashPassword("misma")).not.toBe(await hashPassword("misma"));
  });
});

const stores: [string, () => Promise<{ store: AuthStore; rally: RallyStore; close: () => Promise<void> }>][] = [
  [
    "memoria",
    async () => ({ store: createMemoryAuthStore(), rally: createMemoryRallyStore(), close: async () => {} }),
  ],
];
if (databaseUrl) {
  stores.push([
    "PostgreSQL",
    async () => {
      const pool = new pg.Pool({ connectionString: databaseUrl });
      await pool.query("drop table if exists rally_scores, sessions, auth_identities, users, schema_migrations cascade");
      expect(await migrate(pool)).toEqual([1, 2]);
      expect(await migrate(pool)).toEqual([]);
      return { store: createPgAuthStore(pool), rally: createPgRallyStore(pool), close: () => pool.end() };
    },
  ]);
}

describe.each(stores)("cuentas con correo (%s)", (_name, setup) => {
  let store: AuthStore;
  let close: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    ({ store, close } = await setup());
    app = buildApp({ questions: [], auth: { store, secureCookies: true, attemptsPerMinute: 1000 } });
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  const register = (payload: object) => app.inject({ method: "POST", url: "/api/auth/register", payload });
  const login = (payload: object) => app.inject({ method: "POST", url: "/api/auth/login", payload });
  const me = (token?: string) =>
    app.inject({ method: "GET", url: "/api/auth/me", cookies: token ? { [SESSION_COOKIE]: token } : {} });
  const sessionOf = (res: Awaited<ReturnType<typeof register>>) =>
    res.cookies.find((c) => c.name === SESSION_COOKIE);

  it("registra una cuenta e inicia sesión", async () => {
    const res = await register({ email: "  Ana@Example.COM ", password: "secreta-123", displayName: " Ana " });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: "ana@example.com", displayName: "Ana" });

    const cookie = sessionOf(res)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    const who = await me(cookie.value);
    expect(who.statusCode).toBe(200);
    expect(who.json().user.email).toBe("ana@example.com");
  });

  it("no permite dos cuentas con el mismo correo", async () => {
    const res = await register({ email: "ANA@example.com", password: "otra-clave-1", displayName: "Otra" });
    expect(res.statusCode).toBe(409);
    expect(sessionOf(res)).toBeUndefined();
  });

  it("valida los datos con mensajes en español", async () => {
    const bad = [
      { email: "no-es-correo", password: "secreta-123", displayName: "Ana" },
      { email: "b@example.com", password: "corta", displayName: "Ana" },
      { email: "b@example.com", password: "secreta-123", displayName: " " },
    ];
    for (const payload of bad) {
      const res = await register(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/correo|contraseña|nombre/);
    }
  });

  it("inicia sesión con la contraseña correcta, sin importar mayúsculas en el correo", async () => {
    const res = await login({ email: "ana@EXAMPLE.com", password: "secreta-123" });
    expect(res.statusCode).toBe(200);
    expect((await me(sessionOf(res)!.value)).statusCode).toBe(200);
  });

  it("da el mismo error para contraseña incorrecta y correo inexistente", async () => {
    const wrong = await login({ email: "ana@example.com", password: "equivocada" });
    const missing = await login({ email: "nadie@example.com", password: "secreta-123" });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json()).toEqual(missing.json());
    expect(sessionOf(wrong)).toBeUndefined();
  });

  it("cierra la sesión", async () => {
    const token = sessionOf(await login({ email: "ana@example.com", password: "secreta-123" }))!.value;
    const out = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { [SESSION_COOKIE]: token } });
    expect(out.statusCode).toBe(204);
    expect(sessionOf(out)?.value).toBe("");
    expect((await me(token)).statusCode).toBe(401);
  });

  it("borra la cuenta y deja el correo libre", async () => {
    const res = await register({ email: "borrar@example.com", password: "secreta-123", displayName: "Borrar" });
    const token = sessionOf(res)!.value;
    const del = await app.inject({ method: "DELETE", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: token } });
    expect(del.statusCode).toBe(204);
    expect((await me(token)).statusCode).toBe(401);
    expect((await login({ email: "borrar@example.com", password: "secreta-123" })).statusCode).toBe(401);
    expect((await register({ email: "borrar@example.com", password: "secreta-123", displayName: "Otra" })).statusCode).toBe(201);
    expect((await app.inject({ method: "DELETE", url: "/api/auth/me" })).statusCode).toBe(401);
  });

  it("rechaza sesiones inexistentes o vencidas", async () => {
    expect((await me()).statusCode).toBe(401);
    expect((await me("token-inventado")).statusCode).toBe(401);

    const { user } = (await store.findPasswordIdentity("ana@example.com"))!;
    const { createHash } = await import("node:crypto");
    await store.createSession({
      tokenHash: createHash("sha256").update("vencido").digest(),
      userId: user.id,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await me("vencido")).statusCode).toBe(401);
  });
});

describe.each(stores)("Google y Facebook (%s)", (_name, setup) => {
  let store: AuthStore;
  let close: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;

  // Respuestas simuladas de Google y Facebook.
  let googleProfile: Record<string, unknown>;
  let facebookProfile: Record<string, unknown>;
  let tokenStatus = 200;
  const calls: URL[] = [];
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.href === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("code")).toBe("codigo-ok");
      expect(body.get("code_verifier")).toBeTruthy();
      return reply({ access_token: "token-google" }, tokenStatus);
    }
    if (url.href === "https://openidconnect.googleapis.com/v1/userinfo") return reply(googleProfile);
    if (url.pathname.endsWith("/oauth/access_token")) return reply({ access_token: "token-facebook" }, tokenStatus);
    if (url.pathname.endsWith("/me")) return reply(facebookProfile);
    throw new Error(`llamada inesperada: ${url}`);
  }) as typeof fetch;

  beforeAll(async () => {
    ({ store, close } = await setup());
    app = buildApp({
      questions: [],
      auth: {
        store,
        secureCookies: true,
        attemptsPerMinute: 1000,
        oauth: {
          publicUrl: "https://juego.example",
          google: { clientId: "id-google", clientSecret: "secreto-google" },
          facebook: { clientId: "id-facebook", clientSecret: "secreto-facebook" },
          fetch: fakeFetch,
        },
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "ocupado@example.com", password: "secreta-123", displayName: "Ocupado" },
    });
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  async function signIn(provider: "google" | "facebook", query: (state: string) => Record<string, string>) {
    const start = await app.inject({ method: "GET", url: `/api/auth/${provider}/start` });
    expect(start.statusCode).toBe(302);
    const location = new URL(start.headers.location as string);
    const cookie = start.cookies.find((c) => c.name === OAUTH_COOKIE)!;
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/${provider}/callback`,
      query: query(location.searchParams.get("state")!),
      cookies: { [OAUTH_COOKIE]: cookie.value },
    });
    return { start, location, res, session: res.cookies.find((c) => c.name === SESSION_COOKIE) };
  }
  const ok = (state: string) => ({ code: "codigo-ok", state });
  const me = (token: string) =>
    app.inject({ method: "GET", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: token } }).then((r) => r.json().user);

  it("indica qué proveedores están configurados", async () => {
    expect((await app.inject({ method: "GET", url: "/api/auth/providers" })).json()).toEqual({
      google: true,
      facebook: true,
    });
  });

  it("envía a Google con state, PKCE y la URL de vuelta exacta", async () => {
    const { start, location } = await signIn("google", ok);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("client_id")).toBe("id-google");
    expect(location.searchParams.get("redirect_uri")).toBe("https://juego.example/api/auth/google/callback");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(start.cookies.find((c) => c.name === OAUTH_COOKIE)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/api/auth/google",
    });
  });

  it("crea la cuenta con Google y la reutiliza en el siguiente inicio de sesión", async () => {
    googleProfile = { sub: "g-1", email: "Luis@Gmail.com", email_verified: true, name: "  Luis Pérez " };
    const first = await signIn("google", ok);
    expect(first.res.statusCode).toBe(302);
    expect(first.res.headers.location).toBe("/");
    expect(first.res.cookies.find((c) => c.name === OAUTH_COOKIE)?.value).toBe("");
    const user = await me(first.session!.value);
    expect(user).toMatchObject({ email: "luis@gmail.com", displayName: "Luis Pérez" });

    googleProfile = { ...googleProfile, name: "Otro nombre" };
    const second = await signIn("google", ok);
    expect((await me(second.session!.value)).id).toBe(user.id);
  });

  it("no guarda un correo de Google sin verificar", async () => {
    googleProfile = { sub: "g-2", email: "sin-verificar@gmail.com", email_verified: false, name: "Sin" };
    const { session } = await signIn("google", ok);
    expect((await me(session!.value)).email).toBeNull();
  });

  it("crea la cuenta con Facebook aunque no comparta su correo", async () => {
    facebookProfile = { id: "fb-1", name: "Marta" };
    const { location, session } = await signIn("facebook", ok);
    expect(location.hostname).toBe("www.facebook.com");
    expect(location.searchParams.get("redirect_uri")).toBe("https://juego.example/api/auth/facebook/callback");
    expect(await me(session!.value)).toMatchObject({ email: null, displayName: "Marta" });
    expect(calls.at(-1)!.searchParams.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("no enlaza solo con una cuenta de correo existente", async () => {
    facebookProfile = { id: "fb-2", name: "Intruso", email: "ocupado@example.com" };
    const { res, session } = await signIn("facebook", ok);
    expect(res.headers.location).toBe("/?auth_error=email_taken");
    expect(session).toBeUndefined();
  });

  it("une Google y Facebook en la misma cuenta si traen el mismo correo", async () => {
    googleProfile = { sub: "g-mismo", email: "mismo@gmail.com", email_verified: true, name: "Mismo" };
    const viaGoogle = await me((await signIn("google", ok)).session!.value);

    facebookProfile = { id: "fb-mismo", name: "Mismo FB", email: "Mismo@gmail.com" };
    const first = await signIn("facebook", ok);
    expect(first.res.headers.location).toBe("/");
    expect((await me(first.session!.value)).id).toBe(viaGoogle.id);

    const again = await signIn("facebook", ok);
    expect((await me(again.session!.value)).id).toBe(viaGoogle.id);
  });

  it("vincula Facebook a una cuenta con contraseña desde el perfil", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "vincular@example.com", password: "secreta-123", displayName: "Vincular" },
    });
    const sid = reg.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    facebookProfile = { id: "fb-vincular", name: "Vincular", email: "vincular@example.com" };

    // Sin vincular, Facebook no entra a la cuenta con contraseña.
    expect((await signIn("facebook", ok)).res.headers.location).toBe("/?auth_error=email_taken");

    const start = await app.inject({ method: "GET", url: "/api/auth/facebook/start?link=1" });
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    const oauthCookie = start.cookies.find((c) => c.name === OAUTH_COOKIE)!.value;
    const linked = await app.inject({
      method: "GET",
      url: "/api/auth/facebook/callback",
      query: ok(state),
      cookies: { [OAUTH_COOKIE]: oauthCookie, [SESSION_COOKIE]: sid },
    });
    expect(linked.headers.location).toBe("/?linked=facebook");
    expect((await me(sid)).providers).toEqual(expect.arrayContaining(["password", "facebook"]));

    // Desde ahora Facebook entra a esa misma cuenta.
    const viaFacebook = await signIn("facebook", ok);
    expect((await me(viaFacebook.session!.value)).email).toBe("vincular@example.com");
  });

  it("no vincula una cuenta de Facebook que ya es de otra persona, ni sin sesión", async () => {
    facebookProfile = { id: "fb-vincular", name: "Otro" };
    const other = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "otra@example.com", password: "secreta-123", displayName: "Otra" },
    });
    const sid = other.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const link = async (cookies: Record<string, string>) => {
      const start = await app.inject({ method: "GET", url: "/api/auth/facebook/start?link=1" });
      const state = new URL(start.headers.location as string).searchParams.get("state")!;
      return app.inject({
        method: "GET",
        url: "/api/auth/facebook/callback",
        query: ok(state),
        cookies: { [OAUTH_COOKIE]: start.cookies.find((c) => c.name === OAUTH_COOKIE)!.value, ...cookies },
      });
    };
    expect((await link({ [SESSION_COOKIE]: sid })).headers.location).toBe("/?auth_error=in_use");
    expect((await link({})).headers.location).toBe("/?auth_error=failed");
    expect((await me(sid)).providers).toEqual(["password"]);
  });

  it("rechaza una vuelta con state distinto o sin la cookie", async () => {
    const bad = await signIn("google", () => ({ code: "codigo-ok", state: "otro" }));
    expect(bad.res.headers.location).toBe("/?auth_error=failed");
    expect(bad.session).toBeUndefined();

    const noCookie = await app.inject({ method: "GET", url: "/api/auth/google/callback", query: ok("x") });
    expect(noCookie.headers.location).toBe("/?auth_error=failed");
  });

  it("vuelve al juego si la persona cancela", async () => {
    const { res, session } = await signIn("google", (state) => ({ error: "access_denied", state }));
    expect(res.headers.location).toBe("/?auth_error=cancelled");
    expect(session).toBeUndefined();
  });

  it("al borrar la cuenta, Google crea una nueva la próxima vez", async () => {
    googleProfile = { sub: "g-3", name: "Temporal" };
    const first = await signIn("google", ok);
    const before = await me(first.session!.value);
    await app.inject({ method: "DELETE", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: first.session!.value } });
    const second = await signIn("google", ok);
    expect((await me(second.session!.value)).id).not.toBe(before.id);
  });

  it("avisa si Google o Facebook fallan", async () => {
    tokenStatus = 400;
    const { res, session } = await signIn("facebook", ok);
    tokenStatus = 200;
    expect(res.headers.location).toBe("/?auth_error=failed");
    expect(session).toBeUndefined();
  });
});

describe("sin credenciales de Google ni Facebook", () => {
  it("no muestra los botones ni abre las rutas", async () => {
    const app = buildApp({ questions: [], auth: { store: createMemoryAuthStore(), secureCookies: false } });
    expect((await app.inject({ method: "GET", url: "/api/auth/providers" })).json()).toEqual({
      google: false,
      facebook: false,
    });
    expect((await app.inject({ method: "GET", url: "/api/auth/google/start" })).statusCode).toBe(404);
    await app.close();
  });
});

describe("límite de intentos", () => {
  it("bloquea demasiados intentos de inicio de sesión desde la misma IP", async () => {
    const app = buildApp({
      questions: [],
      auth: { store: createMemoryAuthStore(), secureCookies: false, attemptsPerMinute: 3 },
    });
    const codes = [];
    let last;
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "x@example.com", password: "nada" },
      });
      codes.push(res.statusCode);
      last = res.json();
    }
    expect(codes).toEqual([401, 401, 401, 429]);
    expect(last.error).toMatch(/Demasiados intentos/);
    await app.close();
  });
});

describe.each(stores)("Rally (%s)", (_name, setup) => {
  const questions = loadQuestions(resolve(__dirname, "../../../content/questions"));
  const byId = new Map(questions.map((q) => [q.id, q]));
  let close: () => Promise<void>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    const s = await setup();
    close = s.close;
    app = buildApp({ questions, rally: s.rally, auth: { store: s.store, secureCookies: true, attemptsPerMinute: 1000 } });
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  const cookiesOf = (token?: string) => (token ? { [SESSION_COOKIE]: token } : {});
  const start = (group: string, token?: string) =>
    app.inject({ method: "POST", url: "/api/rally/start", payload: { group }, cookies: cookiesOf(token) });
  const answer = (rallyId: string, choice: number) =>
    app.inject({ method: "POST", url: "/api/rally/answer", payload: { rallyId, choice } });

  /** Contesta bien `streak` preguntas y falla la siguiente. Devuelve la última respuesta. */
  async function play(group: string, streak: number, token?: string) {
    const started = (await start(group, token)).json();
    expect(started.question).not.toHaveProperty("correct");
    let question = started.question;
    const seen = new Set([question.id]);
    for (let i = 0; i < streak; i++) {
      const q = byId.get(question.id)!;
      expect(["A1", "A2"]).toContain(q.level);
      const res = (await answer(started.rallyId, q.correct)).json();
      expect(res).toMatchObject({ correct: true, score: i + 1, over: false });
      expect(seen.has(res.next.id), "no repite preguntas").toBe(false);
      seen.add(res.next.id);
      question = res.next;
    }
    const q = byId.get(question.id)!;
    const last = (await answer(started.rallyId, q.correct === 0 ? 1 : 0)).json();
    expect(last).toMatchObject({ correct: false, score: streak, over: true, correctIndex: q.correct });
    expect((await answer(started.rallyId, 0)).statusCode).toBe(404);
    return last;
  }

  it("sin cuenta se juega pero no entra al ranking", async () => {
    expect((await play("basico", 2)).best).toBeNull();
    expect((await app.inject({ method: "GET", url: "/api/rally/ranking?group=basico" })).json()).toEqual([]);
  });

  it("guarda la mejor racha de cada jugador en el ranking de su grupo", async () => {
    const signUp = async (email: string, displayName: string) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email, password: "secreta-123", displayName },
      });
      return res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    };
    const ana = await signUp("ana.rally@example.com", "Ana");
    const luis = await signUp("luis.rally@example.com", "Luis");

    expect((await play("basico", 3, ana)).best).toBe(3);
    expect((await play("basico", 1, ana)).best).toBe(3);
    expect((await play("basico", 5, luis)).best).toBe(5);
    expect((await play("basico", 0, luis)).best).toBeNull();

    const ranking = await app.inject({ method: "GET", url: "/api/rally/ranking?group=basico" });
    expect(ranking.json()).toEqual([
      { displayName: "Luis", score: 5 },
      { displayName: "Ana", score: 3 },
    ]);
    expect((await app.inject({ method: "GET", url: "/api/rally/ranking?group=avanzado" })).json()).toEqual([]);
  });

  it("rechaza grupos desconocidos", async () => {
    expect((await start("experto")).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/rally/ranking?group=experto" })).statusCode).toBe(400);
  });
});
