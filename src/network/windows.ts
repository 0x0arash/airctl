import type { CommandRunner } from "../runtime/spawn.js";
import type { EstablishedConnection, ListeningSocket, ProcessInfo } from "../domain/types.js";
import { socketIdFor } from "../domain/ids.js";
import { bindScope, familyOf, parsePort } from "./parse.js";
import { parseNetshPortProxy, isWslHelperName, isHyperVHelperName } from "./portproxy.js";

export async function listWindowsSockets(commands: CommandRunner): Promise<ListeningSocket[]> {
  return (await listWindowsNetwork(commands, [])).listening;
}

export async function listWindowsNetwork(
  commands: CommandRunner,
  processes: ProcessInfo[] = [],
): Promise<{ listening: ListeningSocket[]; connections: EstablishedConnection[] }> {
  const [netstat, proxy] = await Promise.all([
    commands.run("netstat", ["-ano"]),
    commands.run("netsh", ["interface", "portproxy", "show", "all"], { timeoutMs: 2500 }),
  ]);
  const parsed = parseNetstat(netstat.stdout || "");
  const rules = proxy.code === 0 ? parseNetshPortProxy(proxy.stdout) : [];
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const listening = parsed.listening.map((socket) =>
    annotateWindowsForward(socket, rules, byPid.get(socket.pid ?? -1)),
  );
  return { listening, connections: parsed.connections };
}

export function parseNetstat(text: string): {
  listening: ListeningSocket[];
  connections: EstablishedConnection[];
} {
  const listening: ListeningSocket[] = [];
  const connections: EstablishedConnection[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(/\s+/);
    const proto = cols[0]?.toUpperCase();
    if (proto === "TCP") {
      const state = cols[3]?.toUpperCase();
      const local = cols[1];
      const remote = cols[2];
      const pidRaw = cols[4];
      if (!local) continue;
      const parsed = parseWindowsLocal(local);
      if (!parsed) continue;
      const pid = pidRaw ? Number.parseInt(pidRaw, 10) : undefined;
      if (state === "LISTENING" || state === "LISTEN") {
        listening.push({
          id: socketIdFor({ ...parsed, protocol: "tcp" }),
          address: parsed.address,
          port: parsed.port,
          protocol: "tcp",
          ...(pid !== undefined && !Number.isNaN(pid) ? { pid } : {}),
          family: parsed.family,
          bindAddress: parsed.address,
          scope: bindScope(parsed.address),
        });
      } else if (state === "ESTABLISHED") {
        const rem = remote ? parseWindowsLocal(remote) : undefined;
        if (!rem) continue;
        connections.push({
          localAddress: parsed.address,
          localPort: parsed.port,
          remoteAddress: rem.address,
          remotePort: rem.port,
          protocol: "tcp",
          ...(pid !== undefined && !Number.isNaN(pid) ? { pid } : {}),
          family: parsed.family,
        });
      }
      continue;
    }
    if (proto === "UDP") {
      const local = cols[1];
      const pidRaw = cols[3] ?? cols[2];
      if (!local) continue;
      const parsed = parseWindowsLocal(local);
      if (!parsed) continue;
      const pid = pidRaw ? Number.parseInt(pidRaw, 10) : undefined;
      if (pidRaw && /[^0-9]/.test(pidRaw) && cols.length >= 4) {
        continue;
      }
      listening.push({
        id: socketIdFor({ ...parsed, protocol: "udp" }),
        address: parsed.address,
        port: parsed.port,
        protocol: "udp",
        ...(pid !== undefined && !Number.isNaN(pid) ? { pid } : {}),
        family: parsed.family,
        bindAddress: parsed.address,
        scope: bindScope(parsed.address),
      });
    }
  }
  return { listening, connections };
}

export function annotateWindowsForward(
  socket: ListeningSocket,
  rules: ReturnType<typeof parseNetshPortProxy>,
  processInfo?: ProcessInfo,
): ListeningSocket {
  const rule = rules.find((r) => r.listenPort === socket.port);
  if (rule) {
    return {
      ...socket,
      forwarded: {
        kind: "portproxy",
        targetAddress: rule.connectAddress,
        targetPort: rule.connectPort,
        detail: `Windows portproxy → ${rule.connectAddress}:${rule.connectPort}`,
      },
    };
  }
  const name = processInfo?.executable ?? processInfo?.executablePath;
  if (isWslHelperName(name)) {
    return {
      ...socket,
      forwarded: {
        kind: "wsl",
        detail: "WSL localhost forwarding (wslrelay/wslhost)",
      },
    };
  }
  if (isHyperVHelperName(name)) {
    return {
      ...socket,
      forwarded: {
        kind: "hyperv",
        detail: "Hyper-V / HNS port proxy",
      },
    };
  }
  return socket;
}

export function parseWindowsLocal(
  local: string,
): { address: string; port: number; family: "ipv4" | "ipv6" } | undefined {
  try {
    if (local.startsWith("[") || local.includes("]:")) {
      const end = local.lastIndexOf("]");
      if (end > 0) {
        const address = local.slice(1, end);
        const port = parsePort(local.slice(end + 2));
        return { address, port, family: "ipv6" };
      }
    }
    if (local.startsWith("::") || (local.match(/:/g) ?? []).length > 1) {
      const last = local.lastIndexOf(":");
      const address = local.slice(0, last) || "::";
      const port = parsePort(local.slice(last + 1));
      return { address: address === "*" ? "::" : address, port, family: "ipv6" };
    }
    const last = local.lastIndexOf(":");
    if (last < 0) return undefined;
    const address = local.slice(0, last);
    const port = parsePort(local.slice(last + 1));
    return { address, port, family: familyOf(address) };
  } catch {
    return undefined;
  }
}
