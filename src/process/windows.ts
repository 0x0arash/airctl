import type { CommandRunner } from "../runtime/spawn.js";
import type { ProcessInfo } from "../domain/types.js";
import { redactCommand } from "../domain/redact.js";
import { inferCwdFromCommand } from "./cwd.js";

export async function listWindowsProcesses(commands: CommandRunner): Promise<ProcessInfo[]> {
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "Get-CimInstance Win32_Process | ForEach-Object {",
    "  $cmd = $_.CommandLine -replace '[\\t\\r\\n]',' '",
    "  $path = $_.ExecutablePath",
    "  $created = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }",
    "  '{0}{7}{1}{7}{2}{7}{3}{7}{4}{7}{5}{7}{6}' -f $_.ProcessId,$_.ParentProcessId,$_.Name,$path,$cmd,$_.WorkingSetSize,$created,([char]9)",
    "}",
  ].join("; ");

  const result = await commands.run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
  if (result.code !== 0 && !result.stdout.trim()) {
    const fallback = await commands.run("tasklist", ["/FO", "CSV", "/NH"]);
    return attachInferredCwds(parseTasklist(fallback.stdout));
  }
  return attachInferredCwds(parseWindowsCim(result.stdout));
}

export function attachInferredCwds(processes: ProcessInfo[]): ProcessInfo[] {
  return processes.map((proc) => {
    if (proc.cwd) return { ...proc, cwdKind: proc.cwdKind ?? "observed" };
    const inferred = inferCwdFromCommand(proc.command, proc.executablePath);
    if (!inferred) return proc;
    return { ...proc, cwd: inferred, cwdKind: "inferred" };
  });
}

export function parseWindowsCim(text: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length !== 7 || !/^\d+$/.test(cols[0] ?? "")) continue;
    const pid = Number.parseInt(cols[0] ?? "", 10);
    if (Number.isNaN(pid)) continue;
    const parentPid = Number.parseInt(cols[1] ?? "", 10);
    const name = emptyToUndef(cols[2]);
    const path = emptyToUndef(cols[3]);
    const command = emptyToUndef(cols[4]);
    const workingSet = Number.parseInt(cols[5] ?? "", 10);
    const created = parseCimDate(cols[6]);
    processes.push({
      pid,
      parentPid: Number.isNaN(parentPid) ? undefined : parentPid,
      executable: name,
      executablePath: path,
      command: redactCommand(command ?? name),
      memoryBytes: Number.isNaN(workingSet) ? undefined : workingSet,
      startedAt: created,
      availability: path && command ? "ok" : "permission-limited",
    });
  }
  return processes;
}

export function parseTasklist(text: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const name = cols[0];
    const pid = Number.parseInt(cols[1] ?? "", 10);
    if (!name || Number.isNaN(pid)) continue;
    processes.push({
      pid,
      executable: name.replace(/\.exe$/i, ""),
      command: name,
      availability: "ok",
    });
  }
  return processes;
}

export function parseCimDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(value);
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
  }
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function emptyToUndef(value: string | undefined): string | undefined {
  if (!value || value === "undefined" || value === "") return undefined;
  return value;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}
