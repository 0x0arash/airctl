import type { FileSystemProvider } from "../runtime/fs.js";
import { mapLimit } from "../runtime/limit.js";
import type { EstablishedConnection, ListeningSocket } from "../domain/types.js";
import { socketIdFor } from "../domain/ids.js";
import { bindScope, familyOf, parseHexIPv4, parseHexIPv6, parseHexPort } from "./parse.js";

export interface LinuxNetworkDiscovery {
  listening: ListeningSocket[];
  connections: EstablishedConnection[];
}

const TCP_LISTEN = "0A";
const TCP_ESTABLISHED = "01";

export async function listLinuxSockets(fs: FileSystemProvider): Promise<ListeningSocket[]> {
  return (await listLinuxNetwork(fs)).listening;
}

export async function listLinuxNetwork(fs: FileSystemProvider): Promise<LinuxNetworkDiscovery> {
  const tables = [
    { path: "/proc/net/tcp", protocol: "tcp" as const, family: "ipv4" as const },
    { path: "/proc/net/tcp6", protocol: "tcp" as const, family: "ipv6" as const },
    { path: "/proc/net/udp", protocol: "udp" as const, family: "ipv4" as const },
    { path: "/proc/net/udp6", protocol: "udp" as const, family: "ipv6" as const },
  ];

  const listeningRows: Array<{ inode: string; socket: Omit<ListeningSocket, "id" | "pid"> }> = [];
  const connectionRows: Array<{ inode: string; connection: Omit<EstablishedConnection, "pid"> }> =
    [];

  for (const table of tables) {
    const text = await fs.readFile(table.path);
    if (!text) continue;
    for (const parsed of parseProcNet(text, table.protocol, table.family)) {
      listeningRows.push(parsed);
    }
    if (table.protocol === "tcp") {
      for (const parsed of parseProcNetEstablished(text, table.family)) {
        connectionRows.push(parsed);
      }
    }
  }

  const inodeToPid = await mapInodesToPids(fs, [
    ...listeningRows.map((r) => r.inode),
    ...connectionRows.map((r) => r.inode),
  ]);

  return {
    listening: listeningRows.map((row) => {
      const pid = inodeToPid.get(row.inode);
      return {
        id: socketIdFor(row.socket),
        ...row.socket,
        ...(pid !== undefined ? { pid } : {}),
      };
    }),
    connections: connectionRows.map((row) => {
      const pid = inodeToPid.get(row.inode);
      return { ...row.connection, ...(pid !== undefined ? { pid } : {}) };
    }),
  };
}

export function parseProcNet(
  text: string,
  protocol: "tcp" | "udp",
  family: "ipv4" | "ipv6",
): Array<{ inode: string; socket: Omit<ListeningSocket, "id" | "pid"> }> {
  const out: Array<{ inode: string; socket: Omit<ListeningSocket, "id" | "pid"> }> = [];
  const lines = text.split(/\r?\n/).slice(1);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(/\s+/);
    const local = cols[1];
    const st = cols[3];
    const inode = cols[9];
    if (!local || !inode) continue;
    if (protocol === "tcp" && st !== TCP_LISTEN) continue;
    if (protocol === "udp" && st !== "07") continue;
    const [addrHex, portHex] = local.split(":");
    if (!addrHex || !portHex) continue;
    try {
      const address = family === "ipv4" ? parseHexIPv4(addrHex) : parseHexIPv6(addrHex);
      const port = parseHexPort(portHex);
      const socket = {
        address,
        port,
        protocol,
        family: familyOf(address),
        bindAddress: address,
        scope: bindScope(address),
      };
      out.push({ inode, socket });
    } catch {
      continue;
    }
  }
  return out;
}

export function parseProcNetEstablished(
  text: string,
  family: "ipv4" | "ipv6",
): Array<{ inode: string; connection: Omit<EstablishedConnection, "pid"> }> {
  const out: Array<{ inode: string; connection: Omit<EstablishedConnection, "pid"> }> = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(/\s+/);
    const local = cols[1];
    const remote = cols[2];
    const st = cols[3];
    const inode = cols[9];
    if (!local || !remote || !inode || st !== TCP_ESTABLISHED) continue;
    const [localHex, localPortHex] = local.split(":");
    const [remoteHex, remotePortHex] = remote.split(":");
    if (!localHex || !localPortHex || !remoteHex || !remotePortHex) continue;
    try {
      const parseAddr = family === "ipv4" ? parseHexIPv4 : parseHexIPv6;
      out.push({
        inode,
        connection: {
          localAddress: parseAddr(localHex),
          localPort: parseHexPort(localPortHex),
          remoteAddress: parseAddr(remoteHex),
          remotePort: parseHexPort(remotePortHex),
          protocol: "tcp",
          family,
        },
      });
    } catch {
      continue;
    }
  }
  return out;
}

async function mapInodesToPids(
  fs: FileSystemProvider,
  inodes: string[],
): Promise<Map<string, number>> {
  const wanted = new Set(inodes);
  const found = new Map<string, number>();
  const pids = await listProcPids(fs);
  await mapLimit(pids, 32, async (pid) => {
    if (found.size >= wanted.size) return;
    const fds = await fs.readDir(`/proc/${pid}/fd`);
    if (!fds) return;
    for (const fd of fds) {
      const link = await fs.readLink(`/proc/${pid}/fd/${fd}`);
      if (!link) continue;
      const match = /^socket:\[(\d+)\]$/.exec(link);
      const inode = match?.[1];
      if (inode && wanted.has(inode) && !found.has(inode)) {
        found.set(inode, pid);
      }
    }
  });
  return found;
}

async function listProcPids(fs: FileSystemProvider): Promise<number[]> {
  const entries = await fs.readDir("/proc");
  if (!entries) return [];
  const pids: number[] = [];
  for (const entry of entries) {
    if (/^\d+$/.test(entry)) pids.push(Number.parseInt(entry, 10));
  }
  return pids;
}
