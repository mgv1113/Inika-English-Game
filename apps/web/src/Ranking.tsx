/** Top 10 de un ranking; `entries` es null mientras carga. */
export function Ranking({ title, entries }: { title: string; entries: { displayName: string; value: string }[] | null }) {
  return (
    <>
      <h3>{title}</h3>
      {entries === null && <p className="muted">Cargando…</p>}
      {entries?.length === 0 && <p className="muted">Todavía nadie aparece. ¡Sé el primero!</p>}
      {!!entries?.length && (
        <ol className="ranking">
          {entries.map((r, i) => (
            <li key={i}>
              <span>{r.displayName}</span>
              <strong>{r.value}</strong>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** "8/10 · 80 %" */
export const formatResult = ({ correct, total }: { correct: number; total: number }) =>
  `${correct}/${total} · ${Math.round((correct / total) * 100)} %`;
