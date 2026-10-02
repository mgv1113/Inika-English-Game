# Arquitectura

```
[Navegador / PWA en PC, Android, iOS]
          │  HTTPS (+ WebSocket en Fase 2)
          ▼
[web: Caddy]  HTTPS automático, sirve la PWA y reenvía /api
          │
          ▼
[server: Node + Fastify]
     │              │
     ▼              ▼
[db: PostgreSQL] [cache: Redis]
```

Todo corre con `docker compose` (ver `docker-compose.yml`).

## Decisiones

- **Una sola PWA** para todas las plataformas. Si más adelante hace falta publicar en tiendas, se empaqueta con Capacitor.
- **La respuesta correcta nunca viaja al cliente** antes de responder: el cliente pide preguntas sin `correct` ni `explanation` y envía su elección a `POST /api/answers`, que devuelve si acertó y la explicación. Esto evita trampas en los modos competitivos.
- **El contenido vive en archivos JSON versionados** (`content/questions`). El servidor los valida al arrancar y los tests fallan si una pregunta está mal formada o le falta la explicación de alguna opción incorrecta.
- **Sin servicios de pago**: Let's Encrypt para HTTPS, sin IA en tiempo real.

## API actual

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del servidor, base de datos y caché |
| GET | `/api/questions/sample?count=5&level=A1` | Preguntas al azar, sin respuesta |
| POST | `/api/answers` | `{ questionId, choice }` → `{ correct, correctIndex, rule, why, examples }` |
| POST | `/api/auth/register` | `{ email, password, displayName }` → `201 { user }` y cookie de sesión; `409` si el correo ya existe |
| POST | `/api/auth/login` | `{ email, password }` → `{ user }` y cookie de sesión; `401` si no coinciden |
| POST | `/api/auth/logout` | Cierra la sesión actual → `204` |
| GET | `/api/auth/me` | `{ user }` si hay sesión, `401` si no |

## Cuentas

- **Tablas** (`apps/server/src/db/migrate.ts`, se aplican solas al arrancar el servidor):
  - `users`: id, correo (único, en minúsculas), nombre visible.
  - `auth_identities`: una fila por forma de entrar (`provider` + `subject`). Hoy solo `password` (subject = correo, con su hash). Google y Facebook se agregan como otra fila del mismo usuario, sin cambiar las tablas.
  - `sessions`: SHA-256 del token de sesión y su vencimiento (30 días).
- **Contraseñas** con scrypt de `node:crypto` (sal aleatoria, sin dependencias externas). Mínimo 8 caracteres.
- **Sesión** en una cookie `sid` `HttpOnly`, `SameSite=Lax` y `Secure` en producción. La base de datos guarda solo el hash del token, así que un respaldo filtrado no permite entrar.
- **Protección**: máximo 10 intentos de registro o inicio de sesión por minuto e IP; el mismo mensaje para correo inexistente y contraseña incorrecta.
- Jugar no requiere cuenta. La cuenta servirá para guardar progreso, XP y racha.

## Próximo (Fase 1)

Inicio de sesión con Google y Facebook, recuperar contraseña, tablas de progreso en PostgreSQL, XP, racha y meta diaria.
