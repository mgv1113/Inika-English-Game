import { useEffect, useState } from "react";
import { fetchProviders, PROVIDER_NAMES, type AuthResult, type Providers, type User } from "./api";

export function AccountCard({
  user,
  notice,
  onDelete,
  onClose,
}: {
  user: User;
  notice?: AuthResult;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [available, setAvailable] = useState<Providers>({ google: false, facebook: false });
  useEffect(() => {
    fetchProviders().then(setAvailable);
  }, []);

  const linked = user.providers ?? [];
  const canLink = (["google", "facebook"] as const).filter((p) => available[p] && !linked.includes(p));

  return (
    <section className="card account-card">
      <p>
        <strong>{user.displayName}</strong>
        {user.email && <span className="muted"> · {user.email}</span>}
      </p>
      {notice && (
        <p className={notice.kind === "linked" ? "form-ok" : "form-error"} role="status">
          {notice.message}
        </p>
      )}
      {linked.length > 0 && (
        <p className="muted">Entras con: {linked.map((p) => PROVIDER_NAMES[p] ?? p).join(", ")}</p>
      )}
      {canLink.map((p) => (
        <a key={p} className={`social-button ${p}`} href={`/api/auth/${p}/start?link=1`}>
          Vincular {PROVIDER_NAMES[p]}
        </a>
      ))}
      <button className="danger" onClick={onDelete}>
        Borrar mi cuenta
      </button>
      <button className="link" onClick={onClose}>
        Volver al juego
      </button>
    </section>
  );
}
