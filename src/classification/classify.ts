import type {
  ListeningSocket,
  ProcessInfo,
  Service,
  ServiceClassification,
} from "../domain/types.js";
import { serviceIdFor } from "../domain/ids.js";
import type { DetectorRegistry } from "../detectors/index.js";
import { projectByCwd } from "../projects/index.js";
import type { Project } from "../domain/types.js";

const SYSTEM_PROCESS_NAMES = new Set([
  "systemd",
  "init",
  "svchost",
  "lsass",
  "csrss",
  "smss",
  "wininit",
  "services",
  "spoolsv",
  "explorer",
  "launchd",
  "kernel_task",
  "WindowServer",
  "syslogd",
  "rpcbind",
  "cupsd",
  "mdnsd",
  "mDNSResponder",
  "System",
  "Registry",
  "Idle",
]);

export const SYSTEM_PORTS = new Set([
  22, 53, 67, 68, 69, 88, 111, 123, 135, 137, 138, 139, 389, 445, 464, 514, 587, 631, 636, 1900,
  5353, 5355, 7680, 27036,
]);

export function classifyServices(input: {
  processes: ProcessInfo[];
  sockets: ListeningSocket[];
  projects: Project[];
  detectors: DetectorRegistry;
}): Service[] {
  const byPid = new Map(input.processes.map((p) => [p.pid, p]));

  const services: Service[] = [];
  const seen = new Set<string>();

  for (const socket of input.sockets) {
    const key = `${socket.pid ?? "nopid"}:${socket.port}:${socket.protocol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const owned = input.sockets.filter(
      (s) => s.port === socket.port && s.protocol === socket.protocol && s.pid === socket.pid,
    );
    const proc = socket.pid !== undefined ? byPid.get(socket.pid) : undefined;
    services.push(classifyProcessService(proc, owned, input.projects, input.detectors));
  }

  return services;
}

function classifyProcessService(
  proc: ProcessInfo | undefined,
  sockets: ListeningSocket[],
  projects: Project[],
  detectors: DetectorRegistry,
): Service {
  const ports = sockets.map((s) => s.port);
  const project = proc ? projectByCwd(projects, proc.cwd) : undefined;
  const executable = baseName(proc?.executable ?? proc?.executablePath ?? "unknown");
  const command = proc?.command ?? executable;
  const processForDetect: ProcessInfo = proc ?? {
    pid: sockets[0]?.pid ?? 0,
    availability: "unknown",
  };
  const hit = detectors.detect({
    process: processForDetect,
    project,
    ports,
    command,
    executable,
  });

  const system = isLikelySystem(proc, sockets);
  const classification: ServiceClassification = hit?.classification
    ? hit.classification
    : system
      ? "system-service"
      : "unknown";

  const primaryPort = sockets[0]?.port;
  const name =
    hit?.name ??
    (project
      ? `${project.name}/${executable}`
      : executable === "unknown"
        ? `port-${primaryPort}`
        : executable);
  return {
    id: serviceIdFor({
      pid: proc?.pid,
      port: primaryPort,
      name,
      projectId: project?.id,
    }),
    projectId: project?.id,
    processId: proc?.pid,
    socketIds: sockets.map((s) => s.id),
    name,
    classification,
    confidence: hit?.confidence ?? (system ? 0.7 : 0.2),
    health: "running",
    framework: hit
      ? { name: hit.name, confidence: hit.confidence, evidence: hit.evidence }
      : undefined,
    evidenceKind: hit && hit.confidence >= 0.8 ? "observed" : hit ? "inferred" : "unknown",
  };
}

export function isLikelySystem(proc: ProcessInfo | undefined, sockets: ListeningSocket[]): boolean {
  const name = baseName(proc?.executable ?? "").toLowerCase();
  if (SYSTEM_PROCESS_NAMES.has(name)) return true;
  if (sockets.every((s) => SYSTEM_PORTS.has(s.port)) && sockets.length > 0) return true;
  if (proc?.cwd === "/" || proc?.cwd === "C:\\Windows\\System32") return true;
  return false;
}

export function isDevelopmentInterest(service: Service): boolean {
  return (
    service.classification === "development-server" ||
    service.classification === "database" ||
    service.classification === "cache" ||
    service.classification === "proxy" ||
    service.classification === "container" ||
    (service.classification === "unknown" && service.confidence < 0.5)
  );
}

function baseName(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const last = parts.at(-1) ?? value;
  return last.replace(/\.exe$/i, "") || value;
}
