import type { AnswerResult, PublicQuestion } from "./api";

/** Una pregunta con sus opciones y, tras contestar, la explicación en español. */
export function QuestionCard({
  q,
  result,
  onChoose,
  onNext,
  nextLabel = "Siguiente",
}: {
  q: PublicQuestion;
  result?: { choice: number; answer: AnswerResult };
  onChoose: (choice: number) => void;
  onNext: () => void;
  nextLabel?: string;
}) {
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
            <button key={option} className={cls} onClick={() => !result && onChoose(i)} disabled={!!result}>
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
          <button onClick={onNext}>{nextLabel}</button>
        </div>
      )}
    </section>
  );
}
