import type { FileSystemProvider } from "../runtime/fs.js";
import { mapLimit } from "../runtime/limit.js";
import type { ProcessInfo } from "../domain/types.js";
import { redactCommand } from "../domain/redact.js";

export async function listLinuxProcesses(fs: FileSystemProvider): Promise<ProcessInfo[]> {
  const entries = await fs.readDir("/proc");
  if (!entries) return [];
  const pids = entries.filter((e) => /^\d+$/.test(e)).map((e) => Number.parseInt(e, 10));
  const processes = await mapLimit(pids, 32, async (pid) => inspectLinuxProcess(fs, pid));
  return processes.filter((p): p is ProcessInfo => p !== undefined);
}

export async function inspectLinuxProcess(
  fs: FileSystemProvider,
  pid: number,
): Promise<ProcessInfo | undefined> {
  const statusText = await fs.readFile(`/proc/${pid}/status`);
  if (!statusText) {
    return { pid, availability: "gone" };
  }
  const status = parseStatus(statusText);
  const statText = await fs.readFile(`/proc/${pid}/stat`);
  const cmdlineRaw = await fs.readFile(`/proc/${pid}/cmdline`);
  const cwd = await fs.realpath(`/proc/${pid}/cwd`);
  const exe = await fs.realpath(`/proc/${pid}/exe`);
  const command = cmdlineRaw ? cmdlineRaw.replaceAll("\0", " ").trim() : status.name;
  const startedAt = parseStartTime(statText);

  return {
    pid,
    parentPid: status.ppid,
    executable: status.name,
    ...(exe ? { executablePath: exe } : {}),
    command: redactCommand(command),
    ...(cwd ? { cwd } : {}),
    ...(status.user ? { user: status.user } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(status.vmRssBytes !== undefined ? { memoryBytes: status.vmRssBytes } : {}),
    availability: cwd ? "ok" : "permission-limited",
  };
}

export function parseStatus(text: string): {
  name?: string;
  ppid?: number;
  user?: string;
  vmRssBytes?: number;
} {
  let name: string | undefined;
  let ppid: number | undefined;
  let uid: string | undefined;
  let vmRssBytes: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("Name:")) name = line.slice(5).trim();
    else if (line.startsWith("PPid:")) ppid = Number.parseInt(line.slice(5).trim(), 10);
    else if (line.startsWith("Uid:")) uid = line.slice(4).trim().split(/\s+/)[0];
    else if (line.startsWith("VmRSS:")) {
      const kb = Number.parseInt(line.slice(6).trim(), 10);
      if (!Number.isNaN(kb)) vmRssBytes = kb * 1024;
    }
  }
  return {
    name,
    ppid: ppid !== undefined && !Number.isNaN(ppid) ? ppid : undefined,
    user: uid,
    vmRssBytes,
  };
}

function parseStartTime(statText: string | undefined): string | undefined {
  if (!statText) return undefined;
  // starttime is field 22; comm may contain spaces/parens. Use the last ')'.
  const close = statText.lastIndexOf(")");
  if (close < 0) return undefined;
  const rest = statText
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const startTicks = Number.parseInt(rest[19] ?? "", 10);
  if (Number.isNaN(startTicks)) return undefined;
  // Cannot convert ticks without btime; leave undefined rather than guessing.
  return undefined;
}
