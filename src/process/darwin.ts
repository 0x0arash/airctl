import type { CommandRunner } from "../runtime/spawn.js";
import type { ProcessInfo } from "../domain/types.js";
import { redactCommand } from "../domain/redact.js";

export async function listDarwinProcesses(commands: CommandRunner): Promise<ProcessInfo[]> {
  const [ps, lsofCwd] = await Promise.all([
    commands.run("ps", ["-axo", "pid=,ppid=,user=,lstart=,rss=,comm="]),
    commands.run("lsof", ["-nP", "-a", "-d", "cwd", "-F", "pn"]),
  ]);
  const args = await commands.run("ps", ["-axo", "pid=,command="]);
  const byPid = parseDarwinPs(ps.stdout, args.stdout);
  const cwds = parseLsofCwds(lsofCwd.stdout);
  for (const proc of byPid.values()) {
    const cwd = cwds.get(proc.pid);
    if (cwd) {
      proc.cwd = cwd;
      if (proc.availability === "permission-limited") proc.availability = "ok";
    }
  }
  return [...byPid.values()];
}

export function parseDarwinPs(psOut: string, commandOut: string): Map<number, ProcessInfo> {
  const commands = new Map<number, string>();
  for (const line of commandOut.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^(\d+)\s+(.*)$/.exec(trimmed);
    if (!match) continue;
    const pid = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isNaN(pid)) commands.set(pid, match[2] ?? "");
  }

  const map = new Map<number, ProcessInfo>();
  for (const line of psOut.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parsePsLine(trimmed);
    if (!parsed) continue;
    const command = commands.get(parsed.pid);
    map.set(parsed.pid, {
      pid: parsed.pid,
      parentPid: parsed.ppid,
      executable: parsed.comm,
      command: redactCommand(command ?? parsed.comm),
      user: parsed.user,
      startedAt: parsed.startedAt,
      memoryBytes: parsed.rssKb * 1024,
      availability: "permission-limited",
    });
  }
  return map;
}

const LSTART_RE =
  /^(\d+)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(\d+)\s+(.*)$/;

export function parsePsLine(
  line: string,
):
  | { pid: number; ppid: number; user: string; startedAt?: string; rssKb: number; comm: string }
  | undefined {
  const match = LSTART_RE.exec(line);
  if (match) {
    const pid = Number.parseInt(match[1] ?? "", 10);
    const ppid = Number.parseInt(match[2] ?? "", 10);
    const rssKb = Number.parseInt(match[5] ?? "", 10);
    if (Number.isNaN(pid)) return undefined;
    return {
      pid,
      ppid,
      user: match[3] ?? "",
      startedAt: parseLstart(match[4] ?? ""),
      rssKb: Number.isNaN(rssKb) ? 0 : rssKb,
      comm: match[6] ?? "",
    };
  }
  const cols = line.trim().split(/\s+/);
  const pid = Number.parseInt(cols[0] ?? "", 10);
  const ppid = Number.parseInt(cols[1] ?? "", 10);
  if (Number.isNaN(pid)) return undefined;
  return {
    pid,
    ppid: Number.isNaN(ppid) ? 0 : ppid,
    user: cols[2] ?? "",
    rssKb: Number.parseInt(cols.at(-2) ?? "", 10) || 0,
    comm: cols.at(-1) ?? "",
  };
}

export function parseLstart(value: string): string | undefined {
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return new Date(date).toISOString();
}

export function parseLsofCwds(text: string): Map<number, string> {
  const map = new Map<number, string>();
  let pid: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("p")) {
      pid = Number.parseInt(line.slice(1), 10);
    } else if (line.startsWith("n") && pid !== undefined && !Number.isNaN(pid)) {
      const cwd = line.slice(1);
      if (cwd && cwd !== "/") map.set(pid, cwd);
    }
  }
  return map;
}
