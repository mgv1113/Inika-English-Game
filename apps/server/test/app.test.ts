import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createMemoryAuthStore } from "../src/auth/memory-store.js";
import { loadQuestions } from "../src/content.js";

const questions = loadQuestions(resolve(__dirname, "../../../content/questions"));

describe("contenido", () => {
  it("carga y valida todas las preguntas", () => {
    expect(questions.length).toBeGreaterThan(0);
  });
});

describe("API", () => {
  const app = buildApp({
    questions,
    checks: { db: async () => false },
    auth: { store: createMemoryAuthStore(), secureCookies: false },
  });

  it("responde health con el estado de cada servicio", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", db: "down" });
  });

  it("no envía la respuesta correcta al cliente", async () => {
    const res = await app.inject({ method: "GET", url: "/api/questions/sample?count=3" });
    const body = res.json();
    expect(body).toHaveLength(3);
    for (const q of body) {
      expect(q).not.toHaveProperty("correct");
      expect(q).not.toHaveProperty("explanation");
    }
  });

  it("explica por qué una respuesta es incorrecta", async () => {
    const q = questions[0];
    const wrongChoice = q.correct === 0 ? 1 : 0;
    const res = await app.inject({
      method: "POST",
      url: "/api/answers",
      payload: { questionId: q.id, choice: wrongChoice },
    });
    const body = res.json();
    expect(body.correct).toBe(false);
    expect(body.correctIndex).toBe(q.correct);
    expect(body.why).toBe(q.explanation.wrong[q.options[wrongChoice]]);
  });

  it("confirma una respuesta correcta", async () => {
    const q = questions[0];
    const res = await app.inject({
      method: "POST",
      url: "/api/answers",
      payload: { questionId: q.id, choice: q.correct },
    });
    expect(res.json()).toMatchObject({ correct: true, why: null });
  });
});
