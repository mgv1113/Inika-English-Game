import { resolve } from "node:path";
import pg from "pg";
import { Redis } from "ioredis";
import { buildApp, type HealthCheck } from "./app.js";
import { loadQuestions } from "./content.js";

const port = Number(process.env.PORT ?? 3000);
const contentDir = resolve(process.env.CONTENT_DIR ?? "../../content/questions");
const questions = loadQuestions(contentDir);

const checks: Record<string, HealthCheck> = {};

if (process.env.DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  checks.db = async () => (await pool.query("select 1")).rowCount === 1;
}

if (process.env.REDIS_URL) {
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  checks.cache = async () => (await redis.ping()) === "PONG";
}

const app = buildApp({ questions, checks, logger: true });
await app.listen({ port, host: "0.0.0.0" });
