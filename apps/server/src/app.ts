import Fastify from "fastify";
import { z } from "zod";
import { authRoutes, type AuthOptions } from "./auth/routes.js";
import { rallyRoutes } from "./rally/routes.js";
import { createMemoryRallyStore, type RallyStore } from "./rally/store.js";
import { grade, LEVEL_GROUPS, LEVELS, MODES, toPublic, type LevelGroup, type Question } from "./content.js";

export type HealthCheck = () => Promise<boolean>;

export interface AppOptions {
  questions: Question[];
  checks?: Record<string, HealthCheck>;
  auth: AuthOptions;
  /** Ranking de Rally. Sin él se guarda en memoria. */
  rally?: RallyStore;
  logger?: boolean;
  /** Número de proxies delante del servidor (para saber la IP real del jugador). */
  trustProxy?: number;
}

/** Máximo de preguntas por partida (Quiz relámpago deja elegir la cantidad). */
export const MAX_QUESTIONS = 100;

const sampleQuery = z.object({
  count: z.coerce.number().int().min(1).max(MAX_QUESTIONS).default(5),
  level: z.enum(LEVELS).optional(),
  group: z.enum(Object.keys(LEVEL_GROUPS) as [LevelGroup, ...LevelGroup[]]).optional(),
  mode: z.enum(MODES).optional(),
});

const answerBody = z.object({
  questionId: z.string(),
  choice: z.number().int().nonnegative(),
});

export function buildApp({ questions, checks = {}, auth, rally, logger = false, trustProxy = 0 }: AppOptions) {
  const app = Fastify({ logger, trustProxy: (_address, hop) => hop < trustProxy });
  app.register(authRoutes, auth);
  app.register(rallyRoutes, { questions, store: rally ?? createMemoryRallyStore(), authStore: auth.store });
  const byId = new Map(questions.map((q) => [q.id, q]));

  app.get("/api/health", async () => {
    const results: Record<string, "up" | "down"> = {};
    for (const [name, check] of Object.entries(checks)) {
      results[name] = (await check().catch(() => false)) ? "up" : "down";
    }
    return { status: "ok", questions: questions.length, ...results };
  });

  // Cuántas preguntas tiene cada grupo; la pantalla desactiva los que no tienen ninguna.
  const groupCounts = Object.fromEntries(
    Object.entries(LEVEL_GROUPS).map(([group, levels]) => [
      group,
      questions.filter((q) => (levels as readonly string[]).includes(q.level)).length,
    ]),
  );
  app.get("/api/levels", async () => groupCounts);

  app.get("/api/questions/sample", async (req, reply) => {
    const parsed = sampleQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const { count, level, group, mode } = parsed.data;
    const levels: readonly string[] | undefined = level ? [level] : group && LEVEL_GROUPS[group];
    const pool = questions.filter((q) => (!levels || levels.includes(q.level)) && (!mode || q.mode === mode));
    const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
    return picked.map(toPublic);
  });

  app.post("/api/answers", async (req, reply) => {
    const parsed = answerBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const q = byId.get(parsed.data.questionId);
    if (!q) return reply.code(404).send({ error: "pregunta no encontrada" });
    const { choice } = parsed.data;
    if (choice >= q.options.length) return reply.code(400).send({ error: "opción fuera de rango" });
    return grade(q, choice);
  });

  return app;
}
