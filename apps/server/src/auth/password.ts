import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Parámetros de scrypt (N=2^15, r=8, p=1): ~32 MB y unas decenas de ms por intento.
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 32;
const MAXMEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...opts, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** Devuelve `scrypt$N$r$p$sal$hash` (sal y hash en base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  const { N, r, p } = PARAMS;
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, Buffer.from(salt, "base64url"), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Hash de relleno para que un correo inexistente tarde lo mismo que una contraseña incorrecta.
let dummyHash: Promise<string> | undefined;
export function burnPasswordCheck(password: string): Promise<boolean> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash.then((h) => verifyPassword(password, h));
}
