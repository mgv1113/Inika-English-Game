import { createHash, randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { PROVIDERS, type OAuthConfig } from "./oauth.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./password.js";
import type { AuthStore, OAuthProvider, User } from "./store.js";

export const SESSION_COOKIE = "sid";
export const OAUTH_COOKIE = "oauth";
const SESSION_DAYS = 30;

export interface AuthOptions {
  store: AuthStore;
  /** Cookies solo por HTTPS. Activado en producción. */
  secureCookies: boolean;
  /** Intentos de registro o inicio de sesión por IP y minuto. */
  attemptsPerMinute?: number;
  /** Google y Facebook. Cada proveedor solo se activa si tiene credenciales. */
  oauth?: OAuthConfig;
}

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Escribe un correo válido." }).max(254, { error: "El correo es demasiado largo." }));

const registerBody = z.object({
  email,
  password: z
    .string()
    .min(8, { error: "La contraseña debe tener al menos 8 caracteres." })
    .max(128, { error: "La contraseña no puede tener más de 128 caracteres." }),
  displayName: z
    .string()
    .trim()
    .min(2, { error: "El nombre debe tener al menos 2 caracteres." })
    .max(40, { error: "El nombre no puede tener más de 40 caracteres." }),
});

const loginBody = z.object({
  email,
  password: z.string().min(1, { error: "Escribe tu contraseña." }).max(128),
});

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: error.issues[0]?.message ?? "Datos no válidos." });
}

function toPublicUser(user: User) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest();

export async function authRoutes(app: FastifyInstance, opts: AuthOptions) {
  const { store, secureCookies, attemptsPerMinute = 10, oauth } = opts;

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
    }),
  });
  const limited = { rateLimit: { max: attemptsPerMinute, timeWindow: "1 minute" } };

  async function startSession(reply: FastifyReply, user: User) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await store.createSession({ tokenHash: hashToken(token), userId: user.id, expiresAt });
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      expires: expiresAt,
    });
  }

  function clearSession(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure: secureCookies });
  }

  async function currentUser(req: FastifyRequest): Promise<User | null> {
    const token = req.cookies[SESSION_COOKIE];
    return token ? store.findSessionUser(hashToken(token)) : null;
  }

  app.post("/api/auth/register", { config: limited }, async (req, reply) => {
    const parsed = registerBody.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { email, password, displayName } = parsed.data;
    const user = await store.createPasswordUser({
      email,
      displayName,
      passwordHash: await hashPassword(password),
    });
    if (!user) return reply.code(409).send({ error: "Ya existe una cuenta con ese correo. Inicia sesión." });
    await startSession(reply, user);
    return reply.code(201).send({ user: toPublicUser(user) });
  });

  app.post("/api/auth/login", { config: limited }, async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const { email, password } = parsed.data;
    const identity = await store.findPasswordIdentity(email);
    const ok = identity
      ? await verifyPassword(password, identity.passwordHash)
      : await burnPasswordCheck(password).then(() => false);
    if (!identity || !ok) return reply.code(401).send({ error: "Correo o contraseña incorrectos." });
    await startSession(reply, identity.user);
    return { user: toPublicUser(identity.user) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await store.deleteSession(hashToken(token));
    clearSession(reply);
    return reply.code(204).send();
  });

  app.get("/api/auth/me", async (req, reply) => {
    const user = await currentUser(req);
    if (!user) {
      if (req.cookies[SESSION_COOKIE]) clearSession(reply);
      return reply.code(401).send({ error: "No has iniciado sesión." });
    }
    return { user: { ...toPublicUser(user), providers: await store.listProviders(user.id) } };
  });

  app.delete("/api/auth/me", async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: "No has iniciado sesión." });
    await store.deleteUser(user.id);
    clearSession(reply);
    return reply.code(204).send();
  });

  const enabled = (Object.keys(PROVIDERS) as OAuthProvider[]).filter((p) => oauth?.[p]);

  app.get("/api/auth/providers", async () => ({
    google: enabled.includes("google"),
    facebook: enabled.includes("facebook"),
  }));

  for (const provider of enabled) {
    const client = oauth![provider]!;
    const flow = PROVIDERS[provider];
    const redirectUri = `${oauth!.publicUrl}/api/auth/${provider}/callback`;
    const httpFetch = oauth!.fetch ?? fetch;
    const cookieOptions = {
      path: `/api/auth/${provider}`,
      httpOnly: true,
      // Lax: el navegador la envía cuando Google o Facebook redirigen de vuelta.
      sameSite: "lax" as const,
      secure: secureCookies,
    };
    const fail = (reply: FastifyReply, error: OAuthError) => {
      reply.clearCookie(OAUTH_COOKIE, cookieOptions);
      return reply.redirect(`/?auth_error=${error}`);
    };

    // `?link=1`: vincular a la cuenta abierta en vez de iniciar sesión.
    app.get(`/api/auth/${provider}/start`, { config: limited }, async (req, reply) => {
      const state = randomBytes(16).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const mode = (req.query as { link?: string }).link === "1" ? "link" : "login";
      reply.setCookie(OAUTH_COOKIE, `${state}.${verifier}.${mode}`, { ...cookieOptions, maxAge: 10 * 60 });
      return reply.redirect(flow.authorizeUrl({ client, redirectUri, state, verifier }));
    });

    const callbackQuery = z.object({
      code: z.string().min(1).optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    });

    app.get(`/api/auth/${provider}/callback`, { config: limited }, async (req, reply) => {
      const query = callbackQuery.safeParse(req.query);
      const [state, verifier, mode] = (req.cookies[OAUTH_COOKIE] ?? "").split(".");
      if (!query.success || !state || !verifier || query.data.state !== state) return fail(reply, "failed");
      if (query.data.error || !query.data.code) return fail(reply, "cancelled");

      if (mode === "link") {
        const current = await currentUser(req);
        if (!current) return fail(reply, "failed");
        let linked: boolean;
        try {
          const profile = await flow.fetchProfile({ client, redirectUri, code: query.data.code, verifier, fetch: httpFetch });
          linked = await store.linkOAuthIdentity({ userId: current.id, provider, subject: profile.subject });
        } catch (err) {
          req.log.warn({ err, provider }, "falló la vinculación externa");
          return fail(reply, "failed");
        }
        if (!linked) return fail(reply, "in_use");
        reply.clearCookie(OAUTH_COOKIE, cookieOptions);
        return reply.redirect(`/?linked=${provider}`);
      }

      let user: User | null;
      try {
        const profile = await flow.fetchProfile({ client, redirectUri, code: query.data.code, verifier, fetch: httpFetch });
        user =
          (await store.findOAuthUser(provider, profile.subject)) ??
          (await store.createOAuthUser({
            provider,
            subject: profile.subject,
            email: profile.email?.trim().toLowerCase() || null,
            displayName: displayNameFrom(profile.name),
          }));
      } catch (err) {
        req.log.warn({ err, provider }, "falló el inicio de sesión externo");
        return fail(reply, "failed");
      }
      if (!user) return fail(reply, "email_taken");

      reply.clearCookie(OAUTH_COOKIE, cookieOptions);
      await startSession(reply, user);
      return reply.redirect("/");
    });
  }
}

/** Motivos que el juego muestra al volver de Google o Facebook (`/?auth_error=...`). */
export type OAuthError = "cancelled" | "email_taken" | "in_use" | "failed";

const displayNameFrom = (name: string | null) => name?.trim().slice(0, 40).trim() || "Jugador";
