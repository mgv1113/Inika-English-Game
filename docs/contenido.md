# Formato del contenido

Las preguntas están en `content/questions/*.json`. Cada archivo es una lista de preguntas.

```json
{
  "id": "pv-give-up-001",
  "mode": "quiz",
  "level": "A2",
  "topic": "phrasal-verbs-give",
  "tags": ["phrasal-verb"],
  "prompt": "Don't ___! You're almost at the finish line.",
  "options": ["give up", "give in", "give away", "give back"],
  "correct": 0,
  "explanation": {
    "rule": "\"Give up\" = rendirse, dejar de intentar.",
    "wrong": {
      "give in": "\"Give in\" = ceder ante la presión de alguien.",
      "give away": "\"Give away\" = regalar algo o revelar un secreto.",
      "give back": "\"Give back\" = devolver algo."
    },
    "examples": [{ "en": "She gave up smoking.", "es": "Ella dejó de fumar." }]
  }
}
```

| Campo | Descripción |
|-------|-------------|
| `id` | Único, en minúsculas con guiones: `<tipo>-<tema>-<número>` |
| `mode` | `quiz` (Quiz relámpago) o `fill` (Completa la frase) |
| `level` | A1, A2, B1, B2, C1 o C2 |
| `topic` | Tema para medir el dominio del jugador |
| `tags` | `grammar`, `vocabulary`, `idiom`, `phrasal-verb`, etc. |
| `prompt` | Enunciado; `___` marca el hueco |
| `options` | Opciones de respuesta |
| `correct` | Índice (desde 0) de la opción correcta |
| `explanation.rule` | La regla en una línea, en español |
| `explanation.wrong` | Por qué cada opción incorrecta está mal (obligatorio para todas) |
| `explanation.examples` | Uno o más ejemplos correctos: `en` en inglés y `es` su traducción al español |

## Guía de estilo

- Explicaciones en español, cortas y directas; ejemplos en inglés.
- Cada distractor debe ser un error que un hispanohablante cometería de verdad.
- Si el error viene de traducir del español, decirlo ("en español decimos…, en inglés no").
- `npm test` valida todo el contenido; no se publica nada que no pase.

## Organización del banco

Un archivo por nivel y bloque: `<nivel>-gramatica.json`, `<nivel>-vocabulario.json` y `<nivel>-phrasal-idioms.json` (A1, A2, B1, B2, C1 y C2). El primer tag de cada pregunta es su tipo (`grammar`, `vocabulary`, `phrasal-verb` o `idiom`).

El juego no tiene un nivel "B2+": las preguntas de B2 alto (frontera con C1) llevan `"level": "B2"` y el tag extra `b2-plus`.
