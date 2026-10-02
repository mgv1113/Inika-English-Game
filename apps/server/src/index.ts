import { resolve } from "node:path";
import pg from "pg";
import { Redis } from "ioredis";
import { buildApp, type HealthCheck } from "./app.js";
import { createMemoryAuthStore } from "./auth/memory-store.js";
import { oauthConfigFromEnv } from "./auth/oauth.js";
import { createPgAuthStore } from "./auth/pg-store.js";
import type { AuthStore } from "./auth/store.js";
import { loadQuestions } from "./content.js";
import { migrate } from "./db/migrate.js";
import { createMemoryRallyStore, createPgRallyStore, type RallyStore } from "./rally/store.js";

const port = Number(process.env.PORT ?? 3000);
const production = process.env.NODE_ENV === "production";
const contentDir = resolve(process.env.CONTENT_DIR ?? "../../content/questions");
const questions = loadQuestions(contentDir);

const checks: Record<string, HealthCheck> = {};
let store: AuthStore;
let rally: RallyStore;

if (process.env.DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  checks.db = async () => (await pool.query("select 1")).rowCount === 1;
  const applied = await migrate(pool);
  if (applied.length) console.log(`migraciones aplicadas: ${applied.join(", ")}`);
  store = createPgAuthStore(pool);
  rally = createPgRallyStore(pool);
} else if (production) {
  throw new Error("DATABASE_URL es obligatorio en producción");
} else {
  console.warn("Sin DATABASE_URL: las cuentas se guardan en memoria y se pierden al reiniciar.");
  store = createMemoryAuthStore();
  rally = createMemoryRallyStore();
}

if (process.env.REDIS_URL) {
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  checks.cache = async () => (await redis.ping()) === "PONG";
}

const oauth = oauthConfigFromEnv(process.env);
const providers = [oauth?.google && "Google", oauth?.facebook && "Facebook"].filter(Boolean);
console.log(`inicio de sesión externo: ${providers.length ? providers.join(", ") : "ninguno configurado"}`);

const app = buildApp({
  questions,
  checks,
  rally,
  auth: { store, secureCookies: production, oauth },
  logger: true,
  trustProxy: Number(process.env.TRUST_PROXY_HOPS ?? 0),
});
await app.listen({ port, host: "0.0.0.0" });
