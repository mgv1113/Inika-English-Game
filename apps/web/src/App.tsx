import { useEffect, useState } from "react";
import { AuthForm } from "./Auth";
import { fetchMe, fetchQuestions, logout, sendAnswer, type AnswerResult, type PublicQuestion, type User } from "./api";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "playing"; questions: PublicQuestion[]; index: number; score: number; result?: { choice: number; answer: AnswerResult } }
  | { phase: "done"; score: number; total: number };

export function App() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [user, setUser] = useState<User | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  const start = () => {
    setState({ phase: "loading" });
    fetchQuestions(5)
      .then((questions) => setState({ phase: "playing", questions, index: 0, score: 0 }))
      .catch((e: Error) => setState({ phase: "error", message: e.message }));
  };

  useEffect(start, []);
  useEffect(() => {
    fetchMe().then(setUser, () => setUser(null));
  }, []);

  const signOut = async () => {
    await logout();
    setUser(null);
  };

  return (
    <main className="app">
      <header>
        <h1>Inika English Game</h1>
        <div className="account">
          {user ? (
            <>
              <span className="muted">Hola, {user.displayName}</span>
              <button className="link" onClick={signOut}>
                Salir
              </button>
            </>
          ) : (
            !showAuth && (
              <button className="link" onClick={() => setShowAuth(true)}>
                Entrar
              </button>
            )
          )}
        </div>
      </header>
      {showAuth && !user && (
        <AuthForm
          onDone={(u) => {
            setUser(u);
            setShowAuth(false);
          }}
          onCancel={() => setShowAuth(false)}
        />
      )}
      {!showAuth && state.phase === "playing" && (
        <p className="score">
          {state.index + 1}/{state.questions.length} · {state.score} pts
        </p>
      )}
      {!showAuth && state.phase === "loading" && <p className="muted">Cargando…</p>}
      {!showAuth && state.phase === "error" && (
        <section className="card">
          <p>{state.message}</p>
          <button onClick={start}>Reintentar</button>
        </section>
      )}
      {!showAuth && state.phase === "playing" && <Round state={state} setState={setState} />}
      {!showAuth && state.phase === "done" && (
        <section className="card center">
          <h2>¡Partida terminada!</h2>
          <p className="big">
            {state.score} / {state.total}
          </p>
          <button onClick={start}>Jugar otra vez</button>
        </section>
      )}
    </main>
  );
}

function Round({
  state,
  setState,
}: {
  state: Extract<State, { phase: "playing" }>;
  setState: (s: State) => void;
}) {
  const q = state.questions[state.index];
  const result = state.result;

  const choose = async (choice: number) => {
    if (result) return;
    const answer = await sendAnswer(q.id, choice);
    setState({ ...state, score: state.score + (answer.correct ? 1 : 0), result: { choice, answer } });
  };

  const next = () => {
    const index = state.index + 1;
    if (index >= state.questions.length) {
      setState({ phase: "done", score: state.score, total: state.questions.length });
    } else {
      setState({ ...state, index, result: undefined });
    }
  };

  return (
    <section className="card">
      <p className="muted">
        {q.level} · {q.mode === "fill" ? "Completa la frase" : "Quiz relámpago"}
      </p>
      <h2 className="prompt">{q.prompt}</h2>
      <div className="options">
        {q.options.map((option, i) => {
          let cls = "option";
          if (result) {
            if (i === result.answer.correctIndex) cls += " right";
            else if (i === result.choice) cls += " wrong";
          }
          return (
            <button key={option} className={cls} onClick={() => choose(i)} disabled={!!result}>
              {option}
            </button>
          );
        })}
      </div>
      {result && (
        <div className={`explanation ${result.answer.correct ? "ok" : "ko"}`}>
          <strong>{result.answer.correct ? "¡Correcto!" : "Casi…"}</strong>
          {result.answer.why && <p>{result.answer.why}</p>}
          <p>
            <em>Regla:</em> {result.answer.rule}
          </p>
          <ul>
            {result.answer.examples.map((ex) => (
              <li key={ex}>{ex}</li>
            ))}
          </ul>
          <button onClick={next}>Siguiente</button>
        </div>
      )}
    </section>
  );
}
