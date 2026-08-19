import { AirCtlError } from "../domain/errors.js";
import type { ProcessId, Snapshot } from "../domain/types.js";
import { parsePortArg } from "../network/parse.js";
import { isDevelopmentInterest } from "../classification/classify.js";

export interface StopTarget {
  pid: ProcessId;
  label: string;
}

export function resolveStopTargets(snapshot: Snapshot, raw: string): StopTarget[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new AirCtlError("INVALID_INPUT", "Usage: airctl stop <pid|:port|project>");
  }

  if (trimmed.startsWith(":") || trimmed.startsWith("port:")) {
    return targetsForPort(snapshot, parsePortArg(trimmed.replace(/^port:/, "")));
  }

  if (/^\d+$/.test(trimmed)) {
    const pid = Number.parseInt(trimmed, 10);
    const proc = snapshot.processes.find((p) => p.pid === pid);
    if (proc) {
      return [{ pid, label: `${proc.executable ?? "process"} (PID ${pid})` }];
    }
    const asPort = Number.parseInt(trimmed, 10);
    if (asPort >= 1 && asPort <= 65535 && snapshot.sockets.some((s) => s.port === asPort)) {
      throw new AirCtlError(
        "INVALID_INPUT",
        `No process with PID ${pid}. To stop whoever owns the port, use: airctl stop :${pid}`,
      );
    }
    return [{ pid, label: `PID ${pid}` }];
  }

  const project = snapshot.projects.find(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase() || p.root === trimmed,
  );
  if (project) return targetsForProject(snapshot, project.id, project.name);

  throw new AirCtlError(
    "INVALID_INPUT",
    `Not a PID, :port, or project: ${trimmed}. Try airctl stop :3000 or airctl stop <project>.`,
  );
}

function targetsForPort(snapshot: Snapshot, port: number): StopTarget[] {
  const sockets = snapshot.sockets.filter((s) => s.port === port && s.pid !== undefined);
  const pids = [
    ...new Set(sockets.map((s) => s.pid).filter((pid): pid is number => pid !== undefined)),
  ];
  if (pids.length === 0) {
    throw new AirCtlError("PORT_NOT_FOUND", `Nothing is listening on port ${port}.`);
  }
  return pids.map((pid) => {
    const proc = snapshot.processes.find((p) => p.pid === pid);
    const forwarded = sockets.find((s) => s.pid === pid)?.forwarded;
    const extra = forwarded ? ` [${forwarded.kind}]` : "";
    return {
      pid,
      label: `${proc?.executable ?? "process"} (PID ${pid}) on :${port}${extra}`,
    };
  });
}

function targetsForProject(snapshot: Snapshot, projectId: string, name: string): StopTarget[] {
  const services = snapshot.services.filter(
    (s) => s.projectId === projectId && s.processId !== undefined && isDevelopmentInterest(s),
  );
  const pids = [
    ...new Set(services.map((s) => s.processId).filter((pid): pid is number => pid !== undefined)),
  ];
  if (pids.length === 0) {
    throw new AirCtlError("PROJECT_NOT_FOUND", `No running services to stop in project ${name}.`);
  }
  return pids.map((pid) => {
    const service = services.find((s) => s.processId === pid);
    return { pid, label: `${service?.name ?? "service"} in ${name} (PID ${pid})` };
  });
}
