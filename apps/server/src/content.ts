import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** Niveles que el jugador elige en la pantalla, agrupando los niveles CEFR. */
export const LEVEL_GROUPS = {
  basico: ["A1", "A2"],
  intermedio: ["B1", "B2"],
  avanzado: ["C1", "C2"],
  todos: LEVELS,
} as const satisfies Record<string, readonly (typeof LEVELS)[number][]>;

export type LevelGroup = keyof typeof LEVEL_GROUPS;

export const questionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    mode: z.enum(["quiz", "fill"]),
    level: z.enum(LEVELS),
    topic: z.string().min(1),
    tags: z.array(z.string()),
    prompt: z.string().min(1),
    options: z.array(z.string().min(1)).min(2),
    correct: z.number().int().nonnegative(),
    explanation: z.object({
      rule: z.string().min(1),
      // Por qué cada opción incorrecta está mal, indexado por el texto de la opción.
      wrong: z.record(z.string(), z.string().min(1)),
      examples: z.array(z.string()).min(1),
    }),
  })
  .superRefine((q, ctx) => {
    if (q.correct >= q.options.length) {
      ctx.addIssue({ code: "custom", message: `correct fuera de rango en ${q.id}` });
    }
    q.options.forEach((option, i) => {
      if (i !== q.correct && !q.explanation.wrong[option]) {
        ctx.addIssue({ code: "custom", message: `falta explicación para "${option}" en ${q.id}` });
      }
    });
  });

export type Question = z.infer<typeof questionSchema>;

/** Pregunta sin la respuesta, tal como se envía al cliente. */
export type PublicQuestion = Omit<Question, "correct" | "explanation">;

export function loadQuestions(dir: string): Question[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const questions = files.flatMap((file) => {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
    return z.array(questionSchema).parse(raw);
  });
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) throw new Error(`id de pregunta repetido: ${q.id}`);
    ids.add(q.id);
  }
  return questions;
}

export function toPublic({ correct: _c, explanation: _e, ...rest }: Question): PublicQuestion {
  return rest;
}
