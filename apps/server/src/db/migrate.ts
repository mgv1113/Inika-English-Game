import type pg from "pg";

/**
 * Migraciones en orden. Nunca se edita una ya publicada: los cambios van en una nueva.
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "cuentas",
    sql: `
      create table users (
        id uuid primary key default gen_random_uuid(),
        email text unique,
        display_name text not null,
        created_at timestamptz not null default now()
      );

      -- Una fila por forma de entrar: 'password' (subject = correo), y más
      -- adelante 'google' o 'facebook' (subject = id de la cuenta externa).
      create table auth_identities (
        id bigserial primary key,
        user_id uuid not null references users (id) on delete cascade,
        provider text not null,
        subject text not null,
        password_hash text,
        created_at timestamptz not null default now(),
        unique (provider, subject),
        check ((provider = 'password') = (password_hash is not null))
      );
      create index auth_identities_user_id on auth_identities (user_id);

      -- Solo se guarda el SHA-256 del token; el token en sí vive en la cookie.
      create table sessions (
        token_hash bytea primary key,
        user_id uuid not null references users (id) on delete cascade,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null
      );
      create index sessions_user_id on sessions (user_id);
    `,
  },
  {
    version: 2,
    name: "ranking-rally",
    sql: `
      -- Mejor racha de cada jugador en cada grupo de niveles (basico, intermedio, ...).
      create table rally_scores (
        user_id uuid not null references users (id) on delete cascade,
        level_group text not null,
        best_score int not null check (best_score > 0),
        achieved_at timestamptz not null default now(),
        primary key (user_id, level_group)
      );
      create index rally_scores_ranking on rally_scores (level_group, best_score desc, achieved_at);
    `,
  },
];

const LOCK_ID = 7_310_001;

export async function migrate(pool: pg.Pool): Promise<number[]> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(
      `create table if not exists schema_migrations (
         version int primary key,
         name text not null,
         applied_at timestamptz not null default now()
       )`,
    );
    const { rows } = await client.query<{ version: number }>("select version from schema_migrations");
    const done = new Set(rows.map((r) => r.version));
    const applied: number[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await client.query("begin");
      try {
        await client.query(m.sql);
        await client.query("insert into schema_migrations (version, name) values ($1, $2)", [m.version, m.name]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
      applied.push(m.version);
    }
    return applied;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
  }
}
