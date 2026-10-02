import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createMemoryAuthStore } from "../src/auth/memory-store.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { createPgAuthStore } from "../src/auth/pg-store.js";
import { SESSION_COOKIE } from "../src/auth/routes.js";
import type { AuthStore } from "../src/auth/store.js";
import { migrate } from "../src/db/migrate.js";

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

const stores: [string, () => Promise<{ store: AuthStore; close: () => Promise<void> }>][] = [
  ["memoria", async () => ({ store: createMemoryAuthStore(), close: async () => {} })],
];
if (databaseUrl) {
  stores.push([
    "PostgreSQL",
    async () => {
      const pool = new pg.Pool({ connectionString: databaseUrl });
      await pool.query("drop table if exists sessions, auth_identities, users, schema_migrations cascade");
      expect(await migrate(pool)).toEqual([1]);
      expect(await migrate(pool)).toEqual([]);
      return { store: createPgAuthStore(pool), close: () => pool.end() };
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
