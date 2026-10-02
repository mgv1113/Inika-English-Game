import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashToken, SESSION_COOKIE } from "../auth/routes.js";
import type { AuthStore } from "../auth/store.js";
import { grade, LEVEL_GROUPS, toPublic, type LevelGroup, type Question } from "../content.js";
import type { RallyStore } from "./store.js";

export interface RallyOptions {
  questions: Question[];
  store: RallyStore;
  authStore: AuthStore;
}

/** Partida de Rally en curso. Vive en el servidor para que la racha no se pueda inventar. */
interface Run {
  group: LevelGroup;
  user: { id: string; displayName: string } | null;
  score: number;
  current: Question;
  seen: Set<string>;
  touched: number;
}

const RUN_TTL_MS = 60 * 60 * 1000;
const MAX_RUNS = 10_000;
const RANKING_SIZE = 10;

const groupSchema = z.enum(Object.keys(LEVEL_GROUPS) as [LevelGroup, ...LevelGroup[]]);
const startBody = z.object({ group: groupSchema });
const answerBody = z.object({ rallyId: z.string(), choice: z.number().int().nonnegative() });
const rankingQuery = z.object({ group: groupSchema });

export async function rallyRoutes(app: FastifyInstance, { questions, store, authStore }: RallyOptions) {
  await app.register(cookie);
  const runs = new Map<string, Run>();

  const pick = (run: Pick<Run, "group" | "seen">) => {
    const levels: readonly string[] = LEVEL_GROUPS[run.group];
    const pool = questions.filter((q) => levels.includes(q.level) && !run.seen.has(q.id));
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  };

  const forgetOld = () => {
    const limit = Date.now() - RUN_TTL_MS;
    for (const [id, run] of runs) if (run.touched < limit) runs.delete(id);
    // Map conserva el orden de inserción: si sigue lleno, se van las más antiguas.
    for (const id of runs.keys()) {
      if (runs.size < MAX_RUNS) break;
      runs.delete(id);
    }
  };

  app.post("/api/rally/start", async (req, reply) => {
    const parsed = startBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const token = req.cookies[SESSION_COOKIE];
    const user = token ? await authStore.findSessionUser(hashToken(token)) : null;
    const run: Omit<Run, "current"> = {
      group: parsed.data.group,
      user: user && { id: user.id, displayName: user.displayName },
      score: 0,
      seen: new Set(),
      touched: Date.now(),
    };
    const first = pick(run);
    if (!first) return reply.code(404).send({ error: "No hay preguntas para este nivel." });
    run.seen.add(first.id);
    forgetOld();
    const rallyId = randomUUID();
    runs.set(rallyId, { ...run, current: first });
    return { rallyId, question: toPublic(first), ranked: !!user };
  });

  app.post("/api/rally/answer", async (req, reply) => {
    const parsed = answerBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const { rallyId, choice } = parsed.data;
    const run = runs.get(rallyId);
    if (!run) return reply.code(404).send({ error: "Esta partida ya terminó. Empieza otra." });
    if (choice >= run.current.options.length) return reply.code(400).send({ error: "opción fuera de rango" });

    const result = grade(run.current, choice);
    run.touched = Date.now();
    if (result.correct) {
      run.score += 1;
      const next = pick(run);
      if (next) {
        run.seen.add(next.id);
        run.current = next;
        return { ...result, score: run.score, over: false, next: toPublic(next) };
      }
    }

    // Falló, o contestó bien todas las preguntas del grupo.
    runs.delete(rallyId);
    const best =
      run.user && run.score > 0
        ? await store.saveScore({ userId: run.user.id, displayName: run.user.displayName, group: run.group, score: run.score })
        : null;
    return { ...result, score: run.score, over: true, best };
  });

  app.get("/api/rally/ranking", async (req, reply) => {
    const parsed = rankingQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    return store.top(parsed.data.group, RANKING_SIZE);
  });
}
