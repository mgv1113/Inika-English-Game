import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const MODES = ["quiz", "fill"] as const;
/** Máximo de preguntas por partida (Quiz relámpago y Completa la frase dejan elegir la cantidad). */
export const MAX_QUESTIONS = 100;

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
    mode: z.enum(MODES),
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
      // Ejemplos correctos en inglés, cada uno con su traducción al español.
      examples: z.array(z.object({ en: z.string().min(1), es: z.string().min(1) })).min(1),
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

/** Preguntas al azar, sin repetir, del grupo de niveles y el modo pedidos. */
export function pickQuestions(
  questions: Question[],
  { group, level, mode, count }: { group?: LevelGroup; level?: (typeof LEVELS)[number]; mode?: (typeof MODES)[number]; count: number },
) {
  const levels: readonly string[] | undefined = level ? [level] : group && LEVEL_GROUPS[group];
  const pool = questions.filter((q) => (!levels || levels.includes(q.level)) && (!mode || q.mode === mode));
  return [...pool].sort(() => Math.random() - 0.5).slice(0, count);
}

/** Resultado de contestar `choice`, con la explicación en español. */
export function grade(q: Question, choice: number) {
  const correct = choice === q.correct;
  return {
    correct,
    correctIndex: q.correct,
    rule: q.explanation.rule,
    why: correct ? null : (q.explanation.wrong[q.options[choice]] ?? null),
    examples: q.explanation.examples,
  };
}

export function toPublic({ correct: _c, explanation: _e, ...rest }: Question): PublicQuestion {
  return rest;
}
