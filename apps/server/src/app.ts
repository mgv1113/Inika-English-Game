import Fastify from "fastify";
import { z } from "zod";
import { authRoutes, type AuthOptions } from "./auth/routes.js";
import { gameRoutes } from "./games/routes.js";
import { createMemoryGameScoreStore, type GameScoreStore } from "./games/store.js";
import { rallyRoutes } from "./rally/routes.js";
import { createMemoryRallyStore, type RallyStore } from "./rally/store.js";
import { grade, LEVEL_GROUPS, LEVELS, MAX_QUESTIONS, MODES, pickQuestions, toPublic, type LevelGroup, type Question } from "./content.js";

export type HealthCheck = () => Promise<boolean>;

export interface AppOptions {
  questions: Question[];
  checks?: Record<string, HealthCheck>;
  auth: AuthOptions;
  /** Ranking de Rally. Sin él se guarda en memoria. */
  rally?: RallyStore;
  /** Ranking de Quiz relámpago, Completa la frase y Partida mixta. Sin él se guarda en memoria. */
  games?: GameScoreStore;
  logger?: boolean;
  /** Número de proxies delante del servidor (para saber la IP real del jugador). */
  trustProxy?: number;
}

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

export function buildApp({ questions, checks = {}, auth, rally, games, logger = false, trustProxy = 0 }: AppOptions) {
  const app = Fastify({ logger, trustProxy: (_address, hop) => hop < trustProxy });
  app.register(authRoutes, auth);
  app.register(rallyRoutes, { questions, store: rally ?? createMemoryRallyStore(), authStore: auth.store });
  app.register(gameRoutes, { questions, store: games ?? createMemoryGameScoreStore(), authStore: auth.store });
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
    return pickQuestions(questions, { count, level, group, mode }).map(toPublic);
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
