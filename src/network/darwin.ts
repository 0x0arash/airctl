import type { CommandRunner } from "../runtime/spawn.js";
import type { EstablishedConnection, ListeningSocket, TransportProtocol } from "../domain/types.js";
import { socketIdFor } from "../domain/ids.js";
import { bindScope, familyOf, parsePort } from "./parse.js";

export async function listDarwinSockets(commands: CommandRunner): Promise<ListeningSocket[]> {
  return (await listDarwinNetwork(commands)).listening;
}

export async function listDarwinNetwork(commands: CommandRunner): Promise<{
  listening: ListeningSocket[];
  connections: EstablishedConnection[];
}> {
  const [tcpListen, udp, established] = await Promise.all([
    commands.run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]),
    commands.run("lsof", ["-nP", "-iUDP", "-F", "pcn"]),
    commands.run("lsof", ["-nP", "-iTCP", "-sTCP:ESTABLISHED", "-F", "pcn"]),
  ]);
  const listening = [
    ...(tcpListen.code === 0
      ? parseLsofFields(tcpListen.stdout, "tcp")
      : parseLsofTable((await fallbackListen(commands)).stdout)),
    ...(udp.code === 0 ? parseLsofFields(udp.stdout, "udp") : []),
  ];
  const connections = established.code === 0 ? parseLsofConnections(established.stdout) : [];
  return { listening, connections };
}

async function fallbackListen(commands: CommandRunner): Promise<{ stdout: string }> {
  const fallback = await commands.run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]);
  return fallback;
}

export function parseLsofFields(
  text: string,
  protocol: TransportProtocol = "tcp",
): ListeningSocket[] {
  const sockets: ListeningSocket[] = [];
  let pid: number | undefined;
  let command: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      pid = Number.parseInt(value, 10);
    } else if (tag === "c") {
      command = value;
    } else if (tag === "n") {
      if (protocol === "udp" && value.includes("->")) continue;
      const parsed = parseLsofName(value);
      if (!parsed || pid === undefined || Number.isNaN(pid)) continue;
      sockets.push({
        id: socketIdFor({ ...parsed, protocol }),
        address: parsed.address,
        port: parsed.port,
        protocol,
        pid,
        family: parsed.family,
        bindAddress: parsed.address,
        scope: bindScope(parsed.address),
      });
      void command;
    }
  }
  return sockets;
}

export function parseLsofConnections(text: string): EstablishedConnection[] {
  const connections: EstablishedConnection[] = [];
  let pid: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      pid = Number.parseInt(value, 10);
    } else if (tag === "n") {
      const parsed = parseLsofConnectionName(value);
      if (!parsed || pid === undefined || Number.isNaN(pid)) continue;
      connections.push({ ...parsed, protocol: "tcp", pid });
    }
  }
  return connections;
}

export function parseLsofTable(text: string): ListeningSocket[] {
  const sockets: ListeningSocket[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split(/\s+/);
    const pid = Number.parseInt(cols[1] ?? "", 10);
    const name = cols.slice(8).join(" ");
    const parsed = parseLsofName(name);
    if (!parsed || Number.isNaN(pid)) continue;
    sockets.push({
      id: socketIdFor({ ...parsed, protocol: "tcp" }),
      address: parsed.address,
      port: parsed.port,
      protocol: "tcp",
      pid,
      family: parsed.family,
      bindAddress: parsed.address,
      scope: bindScope(parsed.address),
    });
  }
  return sockets;
}

export function parseLsofConnectionName(
  name: string,
): Omit<EstablishedConnection, "protocol" | "pid"> | undefined {
  const cleaned = name.replace(/\s+\(.*\)$/, "");
  const arrow = cleaned.indexOf("->");
  if (arrow < 0) return undefined;
  const local = parseLsofName(cleaned.slice(0, arrow));
  const remote = parseLsofName(cleaned.slice(arrow + 2));
  if (!local || !remote) return undefined;
  return {
    localAddress: local.address,
    localPort: local.port,
    remoteAddress: remote.address,
    remotePort: remote.port,
    family: remote.family,
  };
}

export function parseLsofName(
  name: string,
): { address: string; port: number; family: "ipv4" | "ipv6" } | undefined {
  const cleaned = name.replace(/\s+\(.*\)$/, "").replace(/->.*$/, "");
  const match = /^(.*):(\d+)$/.exec(cleaned);
  if (!match) return undefined;
  let address = match[1] ?? "";
  const portRaw = match[2];
  if (!portRaw) return undefined;
  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
  if (address === "*") address = "0.0.0.0";
  try {
    const port = parsePort(portRaw);
    const family = familyOf(address === "::" ? "::" : address);
    if (address === "*" || address === "0.0.0.0") {
      return { address: "0.0.0.0", port, family: "ipv4" };
    }
    return { address, port, family };
  } catch {
    return undefined;
  }
}
