import type { StatusPayload } from "../api/client";
import { healthClass } from "../components/health";

export function Overview({
  status,
  onPort,
}: {
  status: StatusPayload;
  onPort: (port: number) => void;
}) {
  const s = status.summary;
  return (
    <section>
      <h1>Overview</h1>
      <div className="row" aria-label="Summary">
        <div className="stat">
          <b>{s.services}</b>
          <span>services</span>
        </div>
        <div className="stat">
          <b className="good">{s.healthy}</b>
          <span>healthy</span>
        </div>
        <div className="stat">
          <b className="warn">{s.warning}</b>
          <span>warnings</span>
        </div>
        <div className="stat">
          <b className="warn">{s.orphaned}</b>
          <span>orphaned</span>
        </div>
        <div className="stat">
          <b className="bad">{s.unhealthy}</b>
          <span>unhealthy</span>
        </div>
      </div>
      <h2>What is happening</h2>
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Service</th>
            <th>Port</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {status.services.map((service) => (
            <tr key={service.id}>
              <td>{status.projects.find((p) => p.id === service.projectId)?.name ?? "—"}</td>
              <td>{service.name}</td>
              <td className="mono">
                {service.ports.map((port) => (
                  <button key={port} type="button" onClick={() => onPort(port)}>
                    {port}
                  </button>
                ))}
              </td>
              <td className={healthClass(service.health)}>{service.health}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
