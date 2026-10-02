import { randomUUID } from "node:crypto";
import type { AuthStore, OAuthProvider, User } from "./store.js";

/** Almacenamiento en memoria para tests y desarrollo sin PostgreSQL. */
export function createMemoryAuthStore(): AuthStore {
  const users = new Map<string, User>();
  const passwords = new Map<string, { userId: string; passwordHash: string }>();
  const oauth = new Map<string, string>();
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();
  const oauthKey = (provider: OAuthProvider, subject: string) => `${provider}:${subject}`;
  const emailTaken = (email: string) => [...users.values()].some((u) => u.email === email);

  return {
    async createPasswordUser({ email, displayName, passwordHash }) {
      if (emailTaken(email)) return null;
      const user: User = { id: randomUUID(), email, displayName, createdAt: new Date() };
      users.set(user.id, user);
      passwords.set(email, { userId: user.id, passwordHash });
      return user;
    },
    async findPasswordIdentity(email) {
      const identity = passwords.get(email);
      return identity ? { user: users.get(identity.userId)!, passwordHash: identity.passwordHash } : null;
    },
    async findOAuthUser(provider, subject) {
      const userId = oauth.get(oauthKey(provider, subject));
      return userId ? users.get(userId)! : null;
    },
    async createOAuthUser({ provider, subject, email, displayName }) {
      const existing = oauth.get(oauthKey(provider, subject));
      if (existing) return users.get(existing)!;
      if (email && emailTaken(email)) {
        const owner = [...users.values()].find((u) => u.email === email)!;
        const hasPassword = [...passwords.values()].some((p) => p.userId === owner.id);
        if (hasPassword) return null;
        oauth.set(oauthKey(provider, subject), owner.id);
        return owner;
      }
      const user: User = { id: randomUUID(), email, displayName, createdAt: new Date() };
      users.set(user.id, user);
      oauth.set(oauthKey(provider, subject), user.id);
      return user;
    },
    async linkOAuthIdentity({ userId, provider, subject }) {
      const owner = oauth.get(oauthKey(provider, subject));
      if (owner) return owner === userId;
      oauth.set(oauthKey(provider, subject), userId);
      return true;
    },
    async listProviders(userId) {
      const providers = [...oauth].filter(([, id]) => id === userId).map(([key]) => key.split(":")[0]);
      if ([...passwords.values()].some((p) => p.userId === userId)) providers.unshift("password");
      return [...new Set(providers)];
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
    async deleteUser(userId) {
      users.delete(userId);
      for (const [key, value] of passwords) if (value.userId === userId) passwords.delete(key);
      for (const [key, value] of oauth) if (value === userId) oauth.delete(key);
      for (const [key, value] of sessions) if (value.userId === userId) sessions.delete(key);
    },
  };
}
