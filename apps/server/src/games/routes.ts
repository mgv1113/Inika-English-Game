import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashToken, SESSION_COOKIE } from "../auth/routes.js";
import type { AuthStore } from "../auth/store.js";
import { grade, LEVEL_GROUPS, MAX_QUESTIONS, pickQuestions, toPublic, type LevelGroup, type Question } from "../content.js";
import { GAME_MODES, type GameMode, type GameScoreStore } from "./store.js";

export interface GameOptions {
  questions: Question[];
  store: GameScoreStore;
  authStore: AuthStore;
}

/** Partida en curso. El servidor lleva la cuenta para que el resultado del ranking no se pueda inventar. */
interface Game {
  mode: GameMode;
  group: LevelGroup;
  user: { id: string; displayName: string } | null;
  pending: Map<string, Question>;
  total: number;
  correct: number;
  touched: number;
}

const GAME_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_GAMES = 10_000;
const RANKING_SIZE = 10;

const groupSchema = z.enum(Object.keys(LEVEL_GROUPS) as [LevelGroup, ...LevelGroup[]]);
const startBody = z.object({
  mode: z.enum(GAME_MODES),
  group: groupSchema,
  count: z.number().int().min(1).max(MAX_QUESTIONS).default(5),
});
const answerBody = z.object({ gameId: z.string(), questionId: z.string(), choice: z.number().int().nonnegative() });
const rankingQuery = z.object({ mode: z.enum(GAME_MODES), group: groupSchema });

export async function gameRoutes(app: FastifyInstance, { questions, store, authStore }: GameOptions) {
  await app.register(cookie);
  const games = new Map<string, Game>();

  const forgetOld = () => {
    const limit = Date.now() - GAME_TTL_MS;
    for (const [id, game] of games) if (game.touched < limit) games.delete(id);
    for (const id of games.keys()) {
      if (games.size < MAX_GAMES) break;
      games.delete(id);
    }
  };

  app.post("/api/games/start", async (req, reply) => {
    const parsed = startBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const { mode, group, count } = parsed.data;
    const picked = pickQuestions(questions, { group, mode: mode === "mezcla" ? undefined : mode, count });
    if (!picked.length) return reply.code(404).send({ error: "No hay preguntas para este nivel." });
    const token = req.cookies[SESSION_COOKIE];
    const user = token ? await authStore.findSessionUser(hashToken(token)) : null;
    forgetOld();
    const gameId = randomUUID();
    games.set(gameId, {
      mode,
      group,
      user: user && { id: user.id, displayName: user.displayName },
      pending: new Map(picked.map((q) => [q.id, q])),
      total: picked.length,
      correct: 0,
      touched: Date.now(),
    });
    return { gameId, questions: picked.map(toPublic) };
  });

  app.post("/api/games/answer", async (req, reply) => {
    const parsed = answerBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const { gameId, questionId, choice } = parsed.data;
    const game = games.get(gameId);
    if (!game) return reply.code(404).send({ error: "Esta partida ya terminó. Empieza otra." });
    const q = game.pending.get(questionId);
    if (!q) return reply.code(409).send({ error: "Esa pregunta no es de esta partida o ya la contestaste." });
    if (choice >= q.options.length) return reply.code(400).send({ error: "opción fuera de rango" });

    const result = grade(q, choice);
    game.pending.delete(questionId);
    game.touched = Date.now();
    if (result.correct) game.correct += 1;
    if (game.pending.size) return { ...result, score: game.correct, over: false };

    games.delete(gameId);
    const best =
      game.user && game.correct > 0
        ? await store.saveScore({
            userId: game.user.id,
            displayName: game.user.displayName,
            mode: game.mode,
            group: game.group,
            correct: game.correct,
            total: game.total,
          })
        : null;
    return { ...result, score: game.correct, over: true, best };
  });

  app.get("/api/games/ranking", async (req, reply) => {
    const parsed = rankingQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    return store.top(parsed.data.mode, parsed.data.group, RANKING_SIZE);
  });
}
