export interface User {
  id: string;
  email: string | null;
  displayName: string;
  createdAt: Date;
}

/**
 * Almacenamiento de cuentas. Un usuario puede tener varias identidades
 * (`password`, y más adelante `google` o `facebook`), cada una identificada
 * por `provider` + `subject` (el correo para `password`, el id externo para OAuth).
 */
export type OAuthProvider = "google" | "facebook";

export interface AuthStore {
  /** Crea usuario + identidad `password`. Devuelve null si el correo ya está registrado. */
  createPasswordUser(input: { email: string; displayName: string; passwordHash: string }): Promise<User | null>;
  findPasswordIdentity(email: string): Promise<{ user: User; passwordHash: string } | null>;
  /** Usuario dueño de una identidad externa (Google o Facebook), o null si es nueva. */
  findOAuthUser(provider: OAuthProvider, subject: string): Promise<User | null>;
  /**
   * Crea usuario + identidad externa. Devuelve null si el correo ya pertenece a
   * otra cuenta (no se enlaza solo: el registro con correo no verifica el correo).
   */
  createOAuthUser(input: {
    provider: OAuthProvider;
    subject: string;
    email: string | null;
    displayName: string;
  }): Promise<User | null>;
  createSession(input: { tokenHash: Buffer; userId: string; expiresAt: Date }): Promise<void>;
  /** Usuario de una sesión vigente, o null si no existe o ya expiró. */
  findSessionUser(tokenHash: Buffer): Promise<User | null>;
  deleteSession(tokenHash: Buffer): Promise<void>;
  /** Borra la cuenta con sus identidades y sesiones. */
  deleteUser(userId: string): Promise<void>;
}
