export interface PublicQuestion {
  id: string;
  mode: "quiz" | "fill";
  level: string;
  topic: string;
  prompt: string;
  options: string[];
}

export interface AnswerResult {
  correct: boolean;
  correctIndex: number;
  rule: string;
  why: string | null;
  examples: string[];
}

export async function fetchQuestions(count = 5): Promise<PublicQuestion[]> {
  const res = await fetch(`/api/questions/sample?count=${count}`);
  if (!res.ok) throw new Error("No se pudieron cargar las preguntas");
  return res.json();
}

export async function sendAnswer(questionId: string, choice: number): Promise<AnswerResult> {
  const res = await fetch("/api/answers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, choice }),
  });
  if (!res.ok) throw new Error("No se pudo enviar la respuesta");
  return res.json();
}
