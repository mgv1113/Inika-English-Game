# Inika English Game

Juego para aprender inglés (gramática, vocabulario, idioms y phrasal verbs) jugando. Es una PWA: funciona en el navegador de PC, Android e iOS y se puede instalar en la pantalla de inicio.

## Estructura

```
apps/web       PWA en React + Vite
apps/server    API en Node + Fastify
content/       banco de preguntas (JSON) con sus explicaciones
deploy/        Dockerfiles y Caddyfile
docs/          documentación técnica
```

## Desarrollo local

Requiere Node 22.

```bash
npm install
npm run dev:server   # API en http://localhost:3000
npm run dev:web      # juego en http://localhost:5173
```

Comprobaciones (las mismas que corre CI):

```bash
npm run typecheck
npm test
npm run build
```

Sin `DATABASE_URL`, el servidor de desarrollo guarda las cuentas en memoria. Para probar también contra PostgreSQL, define `TEST_DATABASE_URL` (por ejemplo `postgres://inika:inika@localhost:5432/inika_test`) antes de `npm test`; CI lo hace siempre.

## Despliegue en el VPS

Ver [docs/despliegue.md](docs/despliegue.md).

## Documentación

- [Arquitectura](docs/arquitectura.md)
- [Formato del contenido](docs/contenido.md)
