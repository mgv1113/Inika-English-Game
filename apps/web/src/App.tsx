import { useEffect, useState } from "react";
import { AccountCard } from "./Account";
import { AuthForm } from "./Auth";
import { QuestionCard } from "./QuestionCard";
import { Rally } from "./Rally";
import {
  deleteAccount,
  fetchLevelCounts,
  fetchMe,
  fetchQuestions,
  GAME_MODES,
  LEVEL_GROUPS,
  logout,
  sendAnswer,
  takeAuthResult,
  type AnswerResult,
  type GameMode,
  type LevelGroup,
  type PublicQuestion,
  type User,
} from "./api";

type State =
  | { phase: "modes" }
  | { phase: "choose" }
  | { phase: "amount" }
  | { phase: "rally" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "playing"; questions: PublicQuestion[]; index: number; score: number; result?: { choice: number; answer: AnswerResult } }
  | { phase: "done"; score: number; total: number };

/** Máximo que acepta la API en una partida. */
const MAX_QUESTIONS = 100;

// Si volvemos de Google o Facebook con un error, se muestra en el formulario.
const authResult = takeAuthResult();
// Los problemas al vincular se muestran en "Mi cuenta"; los de inicio de sesión, en el formulario.
const accountNotice = authResult && (authResult.kind === "linked" || authResult.code === "in_use") ? authResult : undefined;
const oauthError = authResult?.kind === "error" && !accountNotice ? authResult.message : undefined;

export function App() {
  const [state, setState] = useState<State>({ phase: "modes" });
  const [mode, setMode] = useState<GameMode>("mezcla");
  const [group, setGroup] = useState<LevelGroup>("basico");
  const [amount, setAmount] = useState(5);
  const [manual, setManual] = useState("");
  const [counts, setCounts] = useState<Partial<Record<LevelGroup, number>>>({});
  const [user, setUser] = useState<User | null>(null);
  const [showAuth, setShowAuth] = useState(!!oauthError);
  const [showAccount, setShowAccount] = useState(!!accountNotice);

  const modeName = GAME_MODES.find((m) => m.id === mode)?.name;

  const start = (chosen: LevelGroup = group, howMany = amount) => {
    setGroup(chosen);
    setAmount(howMany);
    if (mode === "rally") {
      setState({ phase: "rally" });
      return;
    }
    setState({ phase: "loading" });
    fetchQuestions(mode, chosen, mode === "quiz" ? howMany : 5)
      .then((questions) => setState({ phase: "playing", questions, index: 0, score: 0 }))
      .catch((e: Error) => setState({ phase: "error", message: e.message }));
  };

  useEffect(() => {
    fetchLevelCounts().then(setCounts, () => setCounts({}));
  }, []);
  useEffect(() => {
    fetchMe().then(setUser, () => setUser(null));
  }, []);

  const signOut = async () => {
    await logout();
    setUser(null);
    setShowAccount(false);
  };

  const removeAccount = async () => {
    if (!window.confirm("¿Borrar tu cuenta y todos sus datos? No se puede deshacer.")) return;
    try {
      await deleteAccount();
      setUser(null);
      setShowAccount(false);
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  return (
    <main className="app">
      <header>
        <h1>
          <picture>
            <source srcSet="/logo-oscuro.svg" media="(prefers-color-scheme: dark)" />
            <img className="logo" src="/logo-claro.svg" alt="Inika English Game" />
          </picture>
        </h1>
        <div className="account">
          {user ? (
            <>
              <button
                className="link"
                onClick={() => {
                  // Refresca las formas de entrar al abrir "Mi cuenta".
                  if (!showAccount) fetchMe().then((u) => u && setUser(u));
                  setShowAccount(!showAccount);
                }}
              >
                {user.displayName}
              </button>
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
      {showAccount && user && (
        <AccountCard user={user} notice={accountNotice} onDelete={removeAccount} onClose={() => setShowAccount(false)} />
      )}
      {showAuth && !user && (
        <AuthForm
          onDone={(u) => {
            setUser(u);
            setShowAuth(false);
          }}
          onCancel={() => setShowAuth(false)}
          initialError={oauthError}
        />
      )}
      {!showAuth && state.phase === "modes" && (
        <section className="card">
          <h2>Modos de juego</h2>
          <div className="levels">
            {GAME_MODES.map((m) => (
              <button
                key={m.name}
                className="option level mode"
                disabled={!m.id}
                onClick={() => {
                  if (!m.id) return;
                  setMode(m.id);
                  setState({ phase: "choose" });
                }}
              >
                <span>{m.name}</span>
                <span className="muted">{m.id ? m.description : "Próximamente"}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {!showAuth && state.phase === "choose" && (
        <section className="card">
          <p className="muted">{modeName}</p>
          <h2>Elige tu nivel</h2>
          <div className="levels">
            {LEVEL_GROUPS.map((g) => {
              const soon = counts[g.id] === 0;
              return (
                <button
                  key={g.id}
                  className="option level"
                  onClick={() => {
                    if (mode !== "quiz") return start(g.id);
                    setGroup(g.id);
                    setState({ phase: "amount" });
                  }}
                  disabled={soon}
                >
                  <span>{g.name}</span>
                  <span className="muted">{soon ? "Próximamente" : g.levels}</span>
                </button>
              );
            })}
          </div>
          <div className="actions">
            <button className="link" onClick={() => setState({ phase: "modes" })}>
              Volver a los modos de juego
            </button>
          </div>
        </section>
      )}
      {!showAuth && state.phase === "amount" && (
        <section className="card">
          <p className="muted">
            {modeName} · {LEVEL_GROUPS.find((g) => g.id === group)?.name}
          </p>
          <h2>¿Cuántas preguntas?</h2>
          <div className="levels">
            {[5, 10, 20].map((n) => (
              <button key={n} className="option level" onClick={() => start(group, n)}>
                <span>{n} preguntas</span>
              </button>
            ))}
          </div>
          <form
            className="manual"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(manual);
              if (Number.isInteger(n) && n >= 1 && n <= MAX_QUESTIONS) start(group, n);
            }}
          >
            <label>
              Manual
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_QUESTIONS}
                placeholder={`1 a ${MAX_QUESTIONS}`}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                required
              />
            </label>
            <button type="submit">Empezar</button>
          </form>
          <div className="actions">
            <button className="link" onClick={() => setState({ phase: "choose" })}>
              Cambiar nivel
            </button>
          </div>
        </section>
      )}
      {!showAuth && state.phase === "playing" && (
        <p className="score">
          {modeName} · {LEVEL_GROUPS.find((g) => g.id === group)?.name} · {state.index + 1}/{state.questions.length} · {state.score} pts
        </p>
      )}
      {!showAuth && state.phase === "loading" && <p className="muted">Cargando…</p>}
      {!showAuth && state.phase === "error" && (
        <section className="card">
          <p>{state.message}</p>
          <button onClick={() => start()}>Reintentar</button>
        </section>
      )}
      {state.phase === "rally" && (
        // Sigue montado mientras se abre "Entrar", para no perder el resultado del Rally.
        <div hidden={showAuth}>
          <Rally
            group={group}
            groupName={LEVEL_GROUPS.find((g) => g.id === group)!.name}
            signedIn={!!user}
            onSignIn={() => setShowAuth(true)}
            onChangeLevel={() => setState({ phase: "choose" })}
            onChangeMode={() => setState({ phase: "modes" })}
          />
        </div>
      )}
      {!showAuth && state.phase === "playing" && <Round state={state} setState={setState} />}
      {!showAuth && state.phase === "done" && (
        <section className="card center">
          <h2>¡Partida terminada!</h2>
          <p className="big">
            {state.score} / {state.total}
          </p>
          <div className="actions">
            <button onClick={() => start()}>Jugar otra vez</button>
            <button className="link" onClick={() => setState({ phase: "choose" })}>
              Cambiar nivel
            </button>
            <button className="link" onClick={() => setState({ phase: "modes" })}>
              Cambiar modo de juego
            </button>
          </div>
        </section>
      )}
      <footer>
        <a href="/privacidad.html">Privacidad</a>
      </footer>
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

  const choose = async (choice: number) => {
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

  return <QuestionCard q={q} result={state.result} onChoose={choose} onNext={next} />;
}
