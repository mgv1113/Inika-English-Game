import { createHash, createHmac } from "node:crypto";
import type { OAuthProvider } from "./store.js";

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface OAuthConfig {
  /** URL pública del juego, sin barra final (p. ej. https://english-game.inikatech.com). */
  publicUrl: string;
  google?: OAuthClient;
  facebook?: OAuthClient;
  /** Para pruebas: sustituye las llamadas HTTP a Google y Facebook. */
  fetch?: typeof fetch;
}

/** Datos de la cuenta externa que usamos para crear la cuenta del juego. */
export interface OAuthProfile {
  subject: string;
  /** Solo si el proveedor lo da por verificado; si no, null. */
  email: string | null;
  name: string | null;
}

interface ProviderFlow {
  authorizeUrl(params: { client: OAuthClient; redirectUri: string; state: string; verifier: string }): string;
  fetchProfile(params: {
    client: OAuthClient;
    redirectUri: string;
    code: string;
    verifier: string;
    fetch: typeof fetch;
  }): Promise<OAuthProfile>;
}

const FACEBOOK_GRAPH = "https://graph.facebook.com/v23.0";

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  return (await res.json()) as T;
}

/** Inicio de sesión de Google (OpenID Connect, flujo de código con PKCE). */
const google: ProviderFlow = {
  authorizeUrl({ client, redirectUri, state, verifier }) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return url.toString();
  },

  async fetchProfile({ client, redirectUri, code, verifier, fetch }) {
    const token = await json<{ access_token: string }>(
      await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: client.clientId,
          client_secret: client.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: verifier,
        }),
      }),
      "token de Google",
    );
    const info = await json<{ sub: string; email?: string; email_verified?: boolean; name?: string }>(
      await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      }),
      "perfil de Google",
    );
    return {
      subject: info.sub,
      email: info.email && info.email_verified ? info.email : null,
      name: info.name ?? null,
    };
  },
};

/** Inicio de sesión de Facebook (flujo de código manual). */
const facebook: ProviderFlow = {
  authorizeUrl({ client, redirectUri, state }) {
    const url = new URL("https://www.facebook.com/v23.0/dialog/oauth");
    url.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "public_profile,email",
      state,
    }).toString();
    return url.toString();
  },

  async fetchProfile({ client, redirectUri, code, fetch }) {
    const tokenUrl = new URL(`${FACEBOOK_GRAPH}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
      code,
    }).toString();
    const token = await json<{ access_token: string }>(await fetch(tokenUrl), "token de Facebook");

    const meUrl = new URL(`${FACEBOOK_GRAPH}/me`);
    meUrl.search = new URLSearchParams({
      fields: "id,name,email",
      access_token: token.access_token,
      // Prueba de que la llamada viene de nuestro servidor (recomendado por Meta).
      appsecret_proof: createHmac("sha256", client.clientSecret).update(token.access_token).digest("hex"),
    }).toString();
    const me = await json<{ id: string; name?: string; email?: string }>(await fetch(meUrl), "perfil de Facebook");
    // Facebook solo entrega correos confirmados; puede no haber correo (cuentas con teléfono).
    return { subject: me.id, email: me.email ?? null, name: me.name ?? null };
  },
};

export const PROVIDERS: Record<OAuthProvider, ProviderFlow> = { google, facebook };

/** Lee la configuración de los proveedores desde variables de entorno; omite los que no tengan credenciales. */
export function oauthConfigFromEnv(env: NodeJS.ProcessEnv): OAuthConfig | undefined {
  const client = (id?: string, secret?: string) =>
    id?.trim() && secret?.trim() ? { clientId: id.trim(), clientSecret: secret.trim() } : undefined;
  const publicUrl = env.PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (!publicUrl) return undefined;
  return {
    publicUrl,
    google: client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    facebook: client(env.FACEBOOK_APP_ID, env.FACEBOOK_APP_SECRET),
  };
}
