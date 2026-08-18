import type { StatusPayload } from "../api/client";

export function WarningsView({ status }: { status: StatusPayload }) {
  return (
    <section>
      <h1>Warnings</h1>
      {status.warnings.length === 0 ? <p className="muted">No warnings.</p> : null}
      {status.warnings.map((warning) => (
        <article className="warning-card" key={warning.id}>
          <h2 className={warning.severity === "error" ? "bad" : "warn"}>{warning.title}</h2>
          <p>{warning.detail}</p>
          <p className="muted">
            {warning.related.port ? `port ${warning.related.port} ` : ""}
            {warning.related.pid ? `pid ${warning.related.pid}` : ""}
          </p>
        </article>
      ))}
    </section>
  );
}
