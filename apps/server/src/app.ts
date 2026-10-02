import Fastify from "fastify";
import { z } from "zod";
import { authRoutes, type AuthOptions } from "./auth/routes.js";
import { LEVEL_GROUPS, LEVELS, toPublic, type LevelGroup, type Question } from "./content.js";

export type HealthCheck = () => Promise<boolean>;

export interface AppOptions {
  questions: Question[];
  checks?: Record<string, HealthCheck>;
  auth: AuthOptions;
  logger?: boolean;
  /** Número de proxies delante del servidor (para saber la IP real del jugador). */
  trustProxy?: number;
}

const sampleQuery = z.object({
  count: z.coerce.number().int().min(1).max(20).default(5),
  level: z.enum(LEVELS).optional(),
  group: z.enum(Object.keys(LEVEL_GROUPS) as [LevelGroup, ...LevelGroup[]]).optional(),
});

const answerBody = z.object({
  questionId: z.string(),
  choice: z.number().int().nonnegative(),
});

export function buildApp({ questions, checks = {}, auth, logger = false, trustProxy = 0 }: AppOptions) {
  const app = Fastify({ logger, trustProxy: (_address, hop) => hop < trustProxy });
  app.register(authRoutes, auth);
  const byId = new Map(questions.map((q) => [q.id, q]));

  app.get("/api/health", async () => {
    const results: Record<string, "up" | "down"> = {};
    for (const [name, check] of Object.entries(checks)) {
      results[name] = (await check().catch(() => false)) ? "up" : "down";
    }
    return { status: "ok", questions: questions.length, ...results };
  });

  app.get("/api/questions/sample", async (req, reply) => {
    const parsed = sampleQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const { count, level, group } = parsed.data;
    const levels: readonly string[] | undefined = level ? [level] : group && LEVEL_GROUPS[group];
    const pool = levels ? questions.filter((q) => levels.includes(q.level)) : questions;
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
    const correct = choice === q.correct;
    return {
      correct,
      correctIndex: q.correct,
      rule: q.explanation.rule,
      why: correct ? null : q.explanation.wrong[q.options[choice]],
      examples: q.explanation.examples,
    };
  });

  return app;
}
