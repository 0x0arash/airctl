import type { CommandRunner } from "../runtime/spawn.js";
import type { ListeningSocket, ProcessId, ProcessInfo } from "../domain/types.js";
import { parsePidCwdTable } from "./cwd.js";

const MAX_PIDS = 80;

export async function enrichWindowsListenerCwds(
  commands: CommandRunner,
  processes: ProcessInfo[],
  sockets: ListeningSocket[],
): Promise<ProcessInfo[]> {
  const byPid = new Map(processes.map((proc) => [proc.pid, proc]));
  const needed = [
    ...new Set(
      sockets
        .map((socket) => socket.pid)
        .filter((pid): pid is number => pid !== undefined && pid > 0),
    ),
  ].filter((pid) => {
    const proc = byPid.get(pid);
    return proc !== undefined && proc.cwdKind !== "observed";
  });
  const found = await queryWindowsProcessCwds(commands, needed);
  if (found.size === 0) return processes;
  return processes.map((proc) => {
    const cwd = found.get(proc.pid);
    if (!cwd) return proc;
    return { ...proc, cwd, cwdKind: "observed" };
  });
}

export async function queryWindowsProcessCwds(
  commands: CommandRunner,
  pids: ProcessId[],
): Promise<Map<number, string>> {
  const unique = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))].slice(
    0,
    MAX_PIDS,
  );
  if (unique.length === 0) return new Map();
  const script = buildWindowsCwdScript(unique);
  const result = await commands.run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeoutMs: 4000 },
  );
  if (!result.stdout.trim()) return new Map();
  return parsePidCwdTable(result.stdout);
}

export function buildWindowsCwdScript(pids: number[]): string {
  const list = pids.map((pid) => String(pid)).join(",");
  return `
$ErrorActionPreference='SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class AirCtlCwd {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint a, bool i, int p);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool IsWow64Process(IntPtr h, out bool wow);
  [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr h, int pic, ref PBI pbi, int len, out int ret);
  [StructLayout(LayoutKind.Sequential)] public struct PBI { public IntPtr A; public IntPtr Peb; public IntPtr B; public IntPtr C; public IntPtr D; public IntPtr E; }
  public static string Get(int pid) {
    IntPtr h = OpenProcess(0x0410, false, pid);
    if (h == IntPtr.Zero) return null;
    try {
      bool wow = false; IsWow64Process(h, out wow); if (wow) return null;
      PBI pbi = new PBI(); int ret;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0 || pbi.Peb == IntPtr.Zero) return null;
      byte[] ptr = new byte[8]; IntPtr n;
      if (!ReadProcessMemory(h, pbi.Peb + 0x20, ptr, 8, out n)) return null;
      long pp = BitConverter.ToInt64(ptr, 0); if (pp == 0) return null;
      byte[] us = new byte[16];
      if (!ReadProcessMemory(h, (IntPtr)(pp + 0x38), us, 16, out n)) return null;
      ushort len = BitConverter.ToUInt16(us, 0); long buf = BitConverter.ToInt64(us, 8);
      if (len == 0 || buf == 0 || len > 1024) return null;
      byte[] path = new byte[len];
      if (!ReadProcessMemory(h, (IntPtr)buf, path, len, out n)) return null;
      return Encoding.Unicode.GetString(path).Trim().TrimEnd('\\\\');
    } finally { CloseHandle(h); }
  }
}
"@
foreach ($pid in @(${list})) {
  $cwd = [AirCtlCwd]::Get([int]$pid)
  if ($cwd) { Write-Output ("$pid\`t$cwd") }
}
`.trim();
}
