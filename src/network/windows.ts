import type { CommandRunner } from "../runtime/spawn.js";
import type { ListeningSocket } from "../domain/types.js";
import { socketIdFor } from "../domain/ids.js";
import { bindScope, familyOf, parsePort } from "./parse.js";

export async function listWindowsSockets(commands: CommandRunner): Promise<ListeningSocket[]> {
  const result = await commands.run("netstat", ["-ano", "-p", "tcp"]);
  if (result.code !== 0 && !result.stdout.trim()) return [];
  return parseNetstat(result.stdout);
}

export function parseNetstat(text: string): ListeningSocket[] {
  const sockets: ListeningSocket[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(/\s+/);
    const proto = cols[0]?.toUpperCase();
    if (proto !== "TCP") continue;
    const state = cols[3]?.toUpperCase();
    if (state !== "LISTENING" && state !== "LISTEN") continue;
    const local = cols[1];
    const pidRaw = cols[4];
    if (!local) continue;
    const parsed = parseWindowsLocal(local);
    if (!parsed) continue;
    const pid = pidRaw ? Number.parseInt(pidRaw, 10) : undefined;
    sockets.push({
      id: socketIdFor({ ...parsed, protocol: "tcp" }),
      address: parsed.address,
      port: parsed.port,
      protocol: "tcp",
      ...(pid !== undefined && !Number.isNaN(pid) ? { pid } : {}),
      family: parsed.family,
      bindAddress: parsed.address,
      scope: bindScope(parsed.address),
    });
  }
  return sockets;
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
