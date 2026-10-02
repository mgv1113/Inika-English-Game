import type pg from "pg";
import type { AuthStore, OAuthProvider, User } from "./store.js";

interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
  created_at: Date;
}

const USER_COLUMNS = "u.id, u.email, u.display_name, u.created_at";

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}

export function createPgAuthStore(pool: pg.Pool): AuthStore {
  async function findOAuthUser(provider: OAuthProvider, subject: string) {
    const { rows } = await pool.query<UserRow>(
      `select ${USER_COLUMNS}
       from auth_identities i join users u on u.id = i.user_id
       where i.provider = $1 and i.subject = $2`,
      [provider, subject],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  return {
    async createPasswordUser({ email, displayName, passwordHash }) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const inserted = await client.query<UserRow>(
          `insert into users (email, display_name) values ($1, $2)
           on conflict (email) do nothing
           returning id, email, display_name, created_at`,
          [email, displayName],
        );
        if (inserted.rowCount === 0) {
          await client.query("rollback");
          return null;
        }
        const user = toUser(inserted.rows[0]);
        await client.query(
          `insert into auth_identities (user_id, provider, subject, password_hash)
           values ($1, 'password', $2, $3)`,
          [user.id, email, passwordHash],
        );
        await client.query("commit");
        return user;
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },

    async findPasswordIdentity(email) {
      const { rows } = await pool.query<UserRow & { password_hash: string }>(
        `select ${USER_COLUMNS}, i.password_hash
         from auth_identities i join users u on u.id = i.user_id
         where i.provider = 'password' and i.subject = $1`,
        [email],
      );
      return rows[0] ? { user: toUser(rows[0]), passwordHash: rows[0].password_hash } : null;
    },

    findOAuthUser,

    async createOAuthUser({ provider, subject, email, displayName }) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const inserted = await client.query<UserRow>(
          `insert into users (email, display_name) values ($1, $2)
           on conflict (email) do nothing
           returning id, email, display_name, created_at`,
          [email, displayName],
        );
        if (inserted.rowCount === 0) {
          // El correo ya existe: enlazar solo si esa cuenta no tiene contraseña.
          const owner = await client.query<UserRow>(
            `select ${USER_COLUMNS} from users u
             where u.email = $1
               and not exists (
                 select 1 from auth_identities p where p.user_id = u.id and p.provider = 'password'
               )`,
            [email],
          );
          if (owner.rowCount === 0) {
            await client.query("rollback");
            return null;
          }
          await client.query(
            `insert into auth_identities (user_id, provider, subject) values ($1, $2, $3)
             on conflict (provider, subject) do nothing`,
            [owner.rows[0].id, provider, subject],
          );
          await client.query("commit");
          return (await findOAuthUser(provider, subject)) ?? toUser(owner.rows[0]);
        }
        const user = toUser(inserted.rows[0]);
        const identity = await client.query(
          `insert into auth_identities (user_id, provider, subject) values ($1, $2, $3)
           on conflict (provider, subject) do nothing`,
          [user.id, provider, subject],
        );
        if (identity.rowCount === 0) {
          // Otra petición creó la misma identidad a la vez: usar esa cuenta.
          await client.query("rollback");
          return findOAuthUser(provider, subject);
        }
        await client.query("commit");
        return user;
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },

    async linkOAuthIdentity({ userId, provider, subject }) {
      await pool.query(
        `insert into auth_identities (user_id, provider, subject) values ($1, $2, $3)
         on conflict (provider, subject) do nothing`,
        [userId, provider, subject],
      );
      const { rows } = await pool.query<{ user_id: string }>(
        "select user_id from auth_identities where provider = $1 and subject = $2",
        [provider, subject],
      );
      return rows[0]?.user_id === userId;
    },

    async listProviders(userId) {
      const { rows } = await pool.query<{ provider: string }>(
        "select distinct provider from auth_identities where user_id = $1 order by provider",
        [userId],
      );
      return rows.map((r) => r.provider);
    },

    async createSession({ tokenHash, userId, expiresAt }) {
      await pool.query("delete from sessions where user_id = $1 and expires_at <= now()", [userId]);
      await pool.query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [
        tokenHash,
        userId,
        expiresAt,
      ]);
    },

    async findSessionUser(tokenHash) {
      const { rows } = await pool.query<UserRow>(
        `select ${USER_COLUMNS}
         from sessions s join users u on u.id = s.user_id
         where s.token_hash = $1 and s.expires_at > now()`,
        [tokenHash],
      );
      return rows[0] ? toUser(rows[0]) : null;
    },

    async deleteSession(tokenHash) {
      await pool.query("delete from sessions where token_hash = $1", [tokenHash]);
    },

    async deleteUser(userId) {
      // Las identidades y sesiones se borran en cascada.
      await pool.query("delete from users where id = $1", [userId]);
    },
  };
}
