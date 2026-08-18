import type { ProcessId, ProcessInfo } from "../domain/types.js";

export function buildProcessTree(processes: ProcessInfo[]): Map<ProcessId, ProcessInfo[]> {
  const children = new Map<ProcessId, ProcessInfo[]>();
  for (const proc of processes) {
    if (proc.parentPid === undefined) continue;
    const list = children.get(proc.parentPid) ?? [];
    list.push(proc);
    children.set(proc.parentPid, list);
  }
  return children;
}

export function ancestorsOf(
  pid: ProcessId,
  byPid: Map<ProcessId, ProcessInfo>,
  limit = 32,
): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  const seen = new Set<ProcessId>();
  let current = byPid.get(pid);
  while (current?.parentPid !== undefined && out.length < limit) {
    if (seen.has(current.parentPid)) break;
    seen.add(current.parentPid);
    const parent = byPid.get(current.parentPid);
    if (!parent) break;
    out.push(parent);
    current = parent;
  }
  return out;
}

export function descendantsOf(
  pid: ProcessId,
  tree: Map<ProcessId, ProcessInfo[]>,
  limit = 256,
): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  const stack = [...(tree.get(pid) ?? [])];
  const seen = new Set<ProcessId>([pid]);
  while (stack.length > 0 && out.length < limit) {
    const next = stack.pop();
    if (!next || seen.has(next.pid)) continue;
    seen.add(next.pid);
    out.push(next);
    stack.push(...(tree.get(next.pid) ?? []));
  }
  return out;
}

export function isShellName(name: string | undefined): boolean {
  if (!name) return false;
  const base = name.replace(/\.(exe)$/i, "").toLowerCase();
  return [
    "bash",
    "zsh",
    "fish",
    "sh",
    "dash",
    "cmd",
    "powershell",
    "pwsh",
    "nu",
    "elvish",
    "tcsh",
    "csh",
    "WindowsTerminal",
    "wt",
    "login",
  ]
    .map((s) => s.toLowerCase())
    .includes(base);
}

export function isInitPid(pid: ProcessId | undefined, platform: NodeJS.Platform): boolean {
  if (pid === undefined) return false;
  if (pid === 0 || pid === 1) return true;
  if (platform === "win32" && (pid === 4 || pid === 0)) return true;
  return false;
}
