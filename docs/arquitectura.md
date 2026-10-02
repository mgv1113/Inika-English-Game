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

## Próximo (Fase 1)

Registro e inicio de sesión (correo, Google, Facebook), tablas de usuarios y progreso en PostgreSQL, XP, racha y meta diaria.
