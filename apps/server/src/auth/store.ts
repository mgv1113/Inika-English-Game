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
export interface AuthStore {
  /** Crea usuario + identidad `password`. Devuelve null si el correo ya está registrado. */
  createPasswordUser(input: { email: string; displayName: string; passwordHash: string }): Promise<User | null>;
  findPasswordIdentity(email: string): Promise<{ user: User; passwordHash: string } | null>;
  createSession(input: { tokenHash: Buffer; userId: string; expiresAt: Date }): Promise<void>;
  /** Usuario de una sesión vigente, o null si no existe o ya expiró. */
  findSessionUser(tokenHash: Buffer): Promise<User | null>;
  deleteSession(tokenHash: Buffer): Promise<void>;
}
