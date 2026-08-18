import { useMemo, useState } from "react";
import type { StatusPayload } from "../api/client";
import { healthClass } from "../components/health";

export function ServicesView({
  status,
  onPort,
  onPid,
}: {
  status: StatusPayload;
  onPort: (port: number) => void;
  onPid: (pid: number) => void;
}) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return status.services.filter((s) =>
      !needle
        ? true
        : `${s.name} ${s.classification} ${s.ports.join(" ")} ${s.processId ?? ""}`
            .toLowerCase()
            .includes(needle),
    );
  }, [q, status.services]);

  return (
    <section>
      <h1>Services</h1>
      <div className="search">
        <input
          aria-label="Filter services"
          placeholder="Filter by name, port, pid…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Class</th>
            <th>Port</th>
            <th>PID</th>
            <th>Health</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((service) => (
            <tr key={service.id}>
              <td>{service.name}</td>
              <td>{service.classification}</td>
              <td className="mono">
                {service.ports.map((port) => (
                  <button key={port} type="button" onClick={() => onPort(port)}>
                    {port}
                  </button>
                ))}
              </td>
              <td className="mono">
                {service.processId ? (
                  <button type="button" onClick={() => onPid(service.processId!)}>
                    {service.processId}
                  </button>
                ) : (
                  "—"
                )}
              </td>
              <td className={healthClass(service.health)}>{service.health}</td>
              <td className="muted">
                {service.evidenceKind}
                {service.framework ? ` · ${service.framework.name}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
