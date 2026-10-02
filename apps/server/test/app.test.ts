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

  it("no repite preguntas ni opciones", () => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, " ").trim();
    const seen = new Map<string, string>();
    for (const q of questions) {
      const options = q.options.map((o) => o.trim().toLowerCase());
      expect(new Set(options).size, `opciones repetidas en ${q.id}`).toBe(options.length);
      const key = `${normalize(q.prompt)}|${options.map(normalize).sort().join("|")}`;
      expect(seen.get(key), `${q.id} repite a ${seen.get(key)}`).toBeUndefined();
      seen.set(key, q.id);
    }
  });

  it("las preguntas \"fill\" tienen un hueco ___", () => {
    for (const q of questions.filter((q) => q.mode === "fill")) {
      expect(q.prompt, q.id).toContain("___");
    }
  });

  it("cubre los niveles A1 a C2", () => {
    for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
      expect(questions.filter((q) => q.level === level).length, level).toBeGreaterThanOrEqual(100);
    }
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

  it("permite partidas de hasta 100 preguntas", async () => {
    const res = await app.inject({ method: "GET", url: "/api/questions/sample?count=100&mode=quiz" });
    expect(res.json()).toHaveLength(100);
    expect(new Set(res.json().map((q: { id: string }) => q.id)).size).toBe(100);
    const tooMany = await app.inject({ method: "GET", url: "/api/questions/sample?count=101" });
    expect(tooMany.statusCode).toBe(400);
  });

  it("filtra por grupo de niveles", async () => {
    const res = await app.inject({ method: "GET", url: "/api/questions/sample?count=20&group=basico" });
    const body = res.json();
    expect(body).toHaveLength(20);
    for (const q of body) expect(["A1", "A2"]).toContain(q.level);
    const counts = (await app.inject({ method: "GET", url: "/api/levels" })).json();
    expect(counts.basico).toBe(questions.filter((q) => ["A1", "A2"].includes(q.level)).length);
    expect(counts.intermedio).toBe(questions.filter((q) => ["B1", "B2"].includes(q.level)).length);
    expect(counts.avanzado).toBe(questions.filter((q) => ["C1", "C2"].includes(q.level)).length);
    expect(counts.todos).toBe(questions.length);
    const fill = (await app.inject({ method: "GET", url: "/api/questions/sample?count=20&group=avanzado&mode=fill" })).json();
    expect(fill).toHaveLength(20);
    for (const q of fill) {
      expect(q.mode).toBe("fill");
      expect(["C1", "C2"]).toContain(q.level);
    }
    const bad = await app.inject({ method: "GET", url: "/api/questions/sample?group=experto" });
    expect(bad.statusCode).toBe(400);
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
