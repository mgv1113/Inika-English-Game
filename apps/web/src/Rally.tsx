import { useEffect, useState } from "react";
import {
  answerRally,
  fetchRallyRanking,
  startRally,
  type LevelGroup,
  type PublicQuestion,
  type RallyAnswer,
} from "./api";
import { QuestionCard } from "./QuestionCard";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "playing"; rallyId: string; question: PublicQuestion; score: number; result?: { choice: number; answer: RallyAnswer } }
  | { phase: "over"; score: number; best: number | null };

/** Rally: preguntas seguidas hasta el primer fallo. Con cuenta, la mejor racha entra al ranking. */
export function Rally({
  group,
  groupName,
  signedIn,
  onSignIn,
  onChangeLevel,
  onChangeMode,
}: {
  group: LevelGroup;
  groupName: string;
  signedIn: boolean;
  onSignIn: () => void;
  onChangeLevel: () => void;
  onChangeMode: () => void;
}) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [ranking, setRanking] = useState<{ displayName: string; score: number }[] | null>(null);

  const begin = () => {
    setState({ phase: "loading" });
    setRanking(null);
    startRally(group)
      .then(({ rallyId, question }) => setState({ phase: "playing", rallyId, question, score: 0 }))
      .catch((e: Error) => setState({ phase: "error", message: e.message }));
  };
  useEffect(begin, [group]);

  if (state.phase === "loading") return <p className="muted">Cargando…</p>;
  if (state.phase === "error") {
    return (
      <section className="card">
        <p>{state.message}</p>
        <button onClick={begin}>Reintentar</button>
      </section>
    );
  }

  if (state.phase === "playing") {
    const { result } = state;
    const choose = async (choice: number) => {
      try {
        const answer = await answerRally(state.rallyId, choice);
        setState({ ...state, score: answer.score, result: { choice, answer } });
      } catch (e) {
        setState({ phase: "error", message: (e as Error).message });
      }
    };
    const next = () => {
      if (!result) return;
      const { answer } = result;
      if (!answer.over && answer.next) {
        setState({ ...state, question: answer.next, result: undefined });
        return;
      }
      setState({ phase: "over", score: answer.score, best: answer.best ?? null });
      fetchRallyRanking(group).then(setRanking, () => setRanking([]));
    };
    return (
      <>
        <p className="score">
          Rally · {groupName} · Racha: {state.score}
        </p>
        <QuestionCard
          q={state.question}
          result={result}
          onChoose={choose}
          onNext={next}
          nextLabel={result?.answer.over ? "Ver resultado" : "Siguiente"}
        />
      </>
    );
  }

  return (
    <section className="card center">
      <h2>¡Fin del Rally!</h2>
      <p className="muted">Respuestas seguidas sin fallar</p>
      <p className="big">{state.score}</p>
      {state.best !== null && <p>Tu mejor marca en {groupName}: {state.best}</p>}
      {!signedIn && (
        <p>
          <button className="link" onClick={onSignIn}>
            Entra con tu cuenta
          </button>{" "}
          para aparecer en el ranking.
        </p>
      )}
      {signedIn && state.best === null && <p className="muted">Tu próxima racha contará para el ranking.</p>}
      <h3>Ranking · {groupName}</h3>
      {ranking === null && <p className="muted">Cargando…</p>}
      {ranking?.length === 0 && <p className="muted">Todavía nadie aparece. ¡Sé el primero!</p>}
      {!!ranking?.length && (
        <ol className="ranking">
          {ranking.map((r, i) => (
            <li key={i}>
              <span>{r.displayName}</span>
              <strong>{r.score}</strong>
            </li>
          ))}
        </ol>
      )}
      <div className="actions">
        <button onClick={begin}>Jugar otra vez</button>
        <button className="link" onClick={onChangeLevel}>
          Cambiar nivel
        </button>
        <button className="link" onClick={onChangeMode}>
          Cambiar modo de juego
        </button>
      </div>
    </section>
  );
}
