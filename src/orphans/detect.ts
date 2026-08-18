import type { ProcessInfo, Service } from "../domain/types.js";
import { ancestorsOf, isInitPid, isShellName } from "../process/tree.js";

export interface OrphanFinding {
  serviceId: string;
  reason: string;
}

export function detectOrphans(input: {
  services: Service[];
  processes: ProcessInfo[];
  platform: NodeJS.Platform;
  cwdExists: (cwd: string) => boolean;
}): OrphanFinding[] {
  const byPid = new Map(input.processes.map((p) => [p.pid, p]));
  const findings: OrphanFinding[] = [];

  for (const service of input.services) {
    if (service.classification === "system-service") continue;
    if (service.classification === "database" || service.classification === "cache") continue;
    if (service.processId === undefined) continue;
    const proc = byPid.get(service.processId);
    if (!proc) continue;

    const reasons: string[] = [];
    if (proc.cwd && !input.cwdExists(proc.cwd)) {
      reasons.push("working directory no longer exists");
    }

    const parent = proc.parentPid !== undefined ? byPid.get(proc.parentPid) : undefined;
    const lineage = ancestorsOf(proc.pid, byPid);
    const parentGone =
      proc.parentPid !== undefined && !parent && !isInitPid(proc.parentPid, input.platform);
    const reparentedToInit =
      isInitPid(proc.parentPid, input.platform) &&
      isLikelyDevServer(service, proc) &&
      !lineage.some((p) => isShellName(p.executable));

    if (parentGone) reasons.push("parent process no longer exists");
    if (reparentedToInit) reasons.push("parent shell is gone; process was reparented to init");

    if (reasons.length === 0) continue;
    findings.push({ serviceId: service.id, reason: reasons.join("; ") });
  }

  return findings;
}

function isLikelyDevServer(service: Service, proc: ProcessInfo): boolean {
  if (service.classification === "development-server") return true;
  const cmd = `${proc.executable ?? ""} ${proc.command ?? ""}`.toLowerCase();
  return /\b(node|vite|next|nuxt|webpack|nodemon|tsx|ts-node|python|flask|django|rails|php)\b/.test(
    cmd,
  );
}
