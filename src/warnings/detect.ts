import type { ListeningSocket, ProcessInfo, Project, Service, Warning } from "../domain/types.js";
import { warningIdFor } from "../domain/ids.js";
import { formatEndpoint } from "../network/parse.js";
import type { OrphanFinding } from "../orphans/detect.js";
import { SYSTEM_PORTS } from "../classification/classify.js";

export function collectWarnings(input: {
  services: Service[];
  sockets: ListeningSocket[];
  processes: ProcessInfo[];
  projects: Project[];
  orphans: OrphanFinding[];
  wantedPorts?: Array<{ projectId: string; port: number; source: string }>;
}): Warning[] {
  const warnings: Warning[] = [];
  const byPid = new Map(input.processes.map((p) => [p.pid, p]));
  const socketsById = new Map(input.sockets.map((s) => [s.id, s]));
  const servicesById = new Map(input.services.map((s) => [s.id, s]));

  for (const socket of input.sockets) {
    if (socket.scope !== "unspecified" && socket.scope !== "public") continue;
    if (SYSTEM_PORTS.has(socket.port)) continue;
    const service = input.services.find((s) => s.socketIds.includes(socket.id));
    if (service?.classification === "system-service") continue;
    warnings.push({
      id: warningIdFor("public-bind", socket.id),
      kind: "public-bind",
      severity: "warning",
      title: "Public interface",
      detail: `${formatEndpoint(socket.address, socket.port)} may be reachable from other machines on the network.`,
      related: { port: socket.port, pid: socket.pid, serviceId: service?.id, socketId: socket.id },
    });
  }

  for (const orphan of input.orphans) {
    const service = servicesById.get(orphan.serviceId);
    warnings.push({
      id: warningIdFor("orphaned", orphan.serviceId),
      kind: "orphaned",
      severity: "warning",
      title: "Likely orphaned process",
      detail: orphan.reason,
      related: { serviceId: orphan.serviceId, pid: service?.processId },
    });
  }

  for (const service of input.services) {
    if (service.health === "unhealthy") {
      warnings.push({
        id: warningIdFor("unhealthy", service.id),
        kind: "unhealthy",
        severity: "error",
        title: "Unhealthy service",
        detail: `${service.name} did not respond to a conservative health check.`,
        related: { serviceId: service.id, pid: service.processId },
      });
    }
    if (service.classification === "unknown" && service.processId !== undefined) {
      const proc = byPid.get(service.processId);
      const hasLoopbackDevPort = service.socketIds.some((id) => {
        const s = socketsById.get(id);
        return (
          s &&
          s.port >= 3000 &&
          s.port <= 9999 &&
          (s.scope === "loopback" || s.scope === "unspecified")
        );
      });
      if (hasLoopbackDevPort && !proc?.cwd) {
        warnings.push({
          id: warningIdFor("unknown-process", service.id),
          kind: "unknown-process",
          severity: "info",
          title: "Unknown process",
          detail: `${service.name} is listening on a development-range port but could not be classified.`,
          related: { serviceId: service.id, pid: service.processId },
        });
      }
    }
  }

  for (const wanted of input.wantedPorts ?? []) {
    const occupant = input.sockets.find((s) => s.port === wanted.port);
    if (!occupant?.pid) continue;
    const occupantService = input.services.find((s) => s.processId === occupant.pid);
    if (occupantService?.projectId === wanted.projectId) continue;
    const proc = byPid.get(occupant.pid);
    warnings.push({
      id: warningIdFor("port-conflict", `${wanted.port}:${wanted.projectId}`),
      kind: "port-conflict",
      severity: "warning",
      title: "Port conflict",
      detail: `Project wants localhost:${wanted.port} (${wanted.source}), but the port is owned by PID ${occupant.pid}${proc?.cwd ? ` (${proc.cwd})` : ""}.`,
      related: {
        port: wanted.port,
        pid: occupant.pid,
        projectId: wanted.projectId,
        serviceId: occupantService?.id,
      },
    });
  }

  return warnings;
}
