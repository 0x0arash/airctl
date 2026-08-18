import type { CommandRunner } from "../runtime/spawn.js";
import type { ListeningSocket } from "../domain/types.js";
import { socketIdFor } from "../domain/ids.js";
import { bindScope, familyOf, parsePort } from "./parse.js";

export async function listDarwinSockets(commands: CommandRunner): Promise<ListeningSocket[]> {
  const result = await commands.run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]);
  if (result.code !== 0) {
    const fallback = await commands.run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]);
    if (fallback.code !== 0) return [];
    return parseLsofTable(fallback.stdout);
  }
  return parseLsofFields(result.stdout);
}

export function parseLsofFields(text: string): ListeningSocket[] {
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
      const parsed = parseLsofName(value);
      if (!parsed || pid === undefined || Number.isNaN(pid)) continue;
      const socket: ListeningSocket = {
        id: socketIdFor({ ...parsed, protocol: "tcp" }),
        address: parsed.address,
        port: parsed.port,
        protocol: "tcp",
        pid,
        family: parsed.family,
        bindAddress: parsed.address,
        scope: bindScope(parsed.address),
      };
      sockets.push(socket);
      void command;
    }
  }
  return sockets;
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

export function parseLsofName(
  name: string,
): { address: string; port: number; family: "ipv4" | "ipv6" } | undefined {
  const cleaned = name.replace(/\s+\(.*\)$/, "");
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
