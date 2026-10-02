import { randomUUID } from "node:crypto";
import type { AuthStore, User } from "./store.js";

/** Almacenamiento en memoria para tests y desarrollo sin PostgreSQL. */
export function createMemoryAuthStore(): AuthStore {
  const users = new Map<string, User>();
  const passwords = new Map<string, { userId: string; passwordHash: string }>();
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();

  return {
    async createPasswordUser({ email, displayName, passwordHash }) {
      if (passwords.has(email)) return null;
      const user: User = { id: randomUUID(), email, displayName, createdAt: new Date() };
      users.set(user.id, user);
      passwords.set(email, { userId: user.id, passwordHash });
      return user;
    },
    async findPasswordIdentity(email) {
      const identity = passwords.get(email);
      return identity ? { user: users.get(identity.userId)!, passwordHash: identity.passwordHash } : null;
    },
    async createSession({ tokenHash, userId, expiresAt }) {
      sessions.set(tokenHash.toString("hex"), { userId, expiresAt });
    },
    async findSessionUser(tokenHash) {
      const session = sessions.get(tokenHash.toString("hex"));
      if (!session || session.expiresAt <= new Date()) return null;
      return users.get(session.userId) ?? null;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash.toString("hex"));
    },
  };
}
