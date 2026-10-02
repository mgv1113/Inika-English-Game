import type pg from "pg";
import type { LevelGroup } from "../content.js";

export interface RallyEntry {
  displayName: string;
  score: number;
}

/** Mejores rachas de Rally: una marca por jugador y grupo de niveles. */
export interface RallyStore {
  /** Guarda la racha si supera la mejor del jugador en ese grupo. Devuelve su mejor marca. */
  saveScore(input: { userId: string; displayName: string; group: LevelGroup; score: number }): Promise<number>;
  /** Los mejores del grupo, de mayor a menor; a igual racha, primero quien la consiguió antes. */
  top(group: LevelGroup, limit: number): Promise<RallyEntry[]>;
}

/** Almacenamiento en memoria para tests y desarrollo sin PostgreSQL. */
export function createMemoryRallyStore(): RallyStore {
  const best = new Map<string, RallyEntry & { group: LevelGroup; at: number }>();
  let clock = 0;
  return {
    async saveScore({ userId, displayName, group, score }) {
      const key = `${userId}:${group}`;
      const current = best.get(key);
      if (!current || score > current.score) best.set(key, { displayName, score, group, at: clock++ });
      return best.get(key)!.score;
    },
    async top(group, limit) {
      return [...best.values()]
        .filter((e) => e.group === group)
        .sort((a, b) => b.score - a.score || a.at - b.at)
        .slice(0, limit)
        .map(({ displayName, score }) => ({ displayName, score }));
    },
  };
}

export function createPgRallyStore(pool: pg.Pool): RallyStore {
  return {
    async saveScore({ userId, group, score }) {
      const { rows } = await pool.query<{ best_score: number }>(
        `insert into rally_scores (user_id, level_group, best_score) values ($1, $2, $3)
         on conflict (user_id, level_group) do update set
           best_score = greatest(rally_scores.best_score, excluded.best_score),
           achieved_at = case when excluded.best_score > rally_scores.best_score
                              then now() else rally_scores.achieved_at end
         returning best_score`,
        [userId, group, score],
      );
      return rows[0].best_score;
    },
    async top(group, limit) {
      const { rows } = await pool.query<{ display_name: string; best_score: number }>(
        `select u.display_name, r.best_score from rally_scores r join users u on u.id = r.user_id
         where r.level_group = $1 order by r.best_score desc, r.achieved_at asc limit $2`,
        [group, limit],
      );
      return rows.map((r) => ({ displayName: r.display_name, score: r.best_score }));
    },
  };
}
