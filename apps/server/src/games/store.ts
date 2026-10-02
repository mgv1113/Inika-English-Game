import type pg from "pg";
import type { LevelGroup } from "../content.js";

export const GAME_MODES = ["quiz", "fill", "mezcla"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export interface GameResult {
  correct: number;
  total: number;
}

export interface GameEntry extends GameResult {
  displayName: string;
}

/**
 * Mejor partida de cada jugador por modo y grupo de niveles. Gana el mayor
 * porcentaje de aciertos; a igual porcentaje, la partida con más preguntas.
 */
export interface GameScoreStore {
  /** Guarda la partida si mejora la marca del jugador. Devuelve su mejor partida. */
  saveScore(input: { userId: string; displayName: string; mode: GameMode; group: LevelGroup } & GameResult): Promise<GameResult>;
  /** Los mejores del modo y grupo; a igualdad total, primero quien la consiguió antes. */
  top(mode: GameMode, group: LevelGroup, limit: number): Promise<GameEntry[]>;
}

/** Compara dos partidas: positivo si `a` es mejor que `b`. */
export function compareResults(a: GameResult, b: GameResult) {
  return a.correct * b.total - b.correct * a.total || a.total - b.total;
}

/** Almacenamiento en memoria para tests y desarrollo sin PostgreSQL. */
export function createMemoryGameScoreStore(): GameScoreStore {
  const best = new Map<string, GameEntry & { mode: GameMode; group: LevelGroup; at: number }>();
  let clock = 0;
  return {
    async saveScore({ userId, displayName, mode, group, correct, total }) {
      const key = `${userId}:${mode}:${group}`;
      const current = best.get(key);
      if (!current || compareResults({ correct, total }, current) > 0) {
        best.set(key, { displayName, correct, total, mode, group, at: clock++ });
      }
      const { correct: c, total: t } = best.get(key)!;
      return { correct: c, total: t };
    },
    async top(mode, group, limit) {
      return [...best.values()]
        .filter((e) => e.mode === mode && e.group === group)
        .sort((a, b) => compareResults(b, a) || a.at - b.at)
        .slice(0, limit)
        .map(({ displayName, correct, total }) => ({ displayName, correct, total }));
    },
  };
}

export function createPgGameScoreStore(pool: pg.Pool): GameScoreStore {
  return {
    async saveScore({ userId, mode, group, correct, total }) {
      // Solo se reemplaza si mejora: más porcentaje (sin decimales, en cruz), o igual con más preguntas.
      await pool.query(
        `insert into game_scores (user_id, mode, level_group, correct, total) values ($1, $2, $3, $4, $5)
         on conflict (user_id, mode, level_group) do update set
           correct = excluded.correct, total = excluded.total, achieved_at = now()
         where excluded.correct * game_scores.total > game_scores.correct * excluded.total
            or (excluded.correct * game_scores.total = game_scores.correct * excluded.total
                and excluded.total > game_scores.total)`,
        [userId, mode, group, correct, total],
      );
      const { rows } = await pool.query<GameResult>(
        "select correct, total from game_scores where user_id = $1 and mode = $2 and level_group = $3",
        [userId, mode, group],
      );
      return rows[0];
    },
    async top(mode, group, limit) {
      const { rows } = await pool.query<{ display_name: string; correct: number; total: number }>(
        `select u.display_name, g.correct, g.total from game_scores g join users u on u.id = g.user_id
         where g.mode = $1 and g.level_group = $2
         order by g.correct::float / g.total desc, g.total desc, g.achieved_at asc limit $3`,
        [mode, group, limit],
      );
      return rows.map((r) => ({ displayName: r.display_name, correct: r.correct, total: r.total }));
    },
  };
}
