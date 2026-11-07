import type { Port } from "../domain/types.js";
import { parsePort } from "./parse.js";

export interface PortProxyRule {
  listenAddress: string;
  listenPort: Port;
  connectAddress: string;
  connectPort: Port;
}

const ADDR_PORT = /^(\S+)\s+(\d{1,5})\s+(\S+)\s+(\d{1,5})$/;

export function parseNetshPortProxy(text: string): PortProxyRule[] {
  const rules: PortProxyRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^listen on|^address|^-+$/i.test(trimmed)) continue;
    const match = ADDR_PORT.exec(trimmed);
    if (!match) continue;
    try {
      rules.push({
        listenAddress: normalizeProxyAddress(match[1] ?? ""),
        listenPort: parsePort(match[2] ?? ""),
        connectAddress: normalizeProxyAddress(match[3] ?? ""),
        connectPort: parsePort(match[4] ?? ""),
      });
    } catch {
      continue;
    }
  }
  return rules;
}

function normalizeProxyAddress(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "*" || trimmed.toLowerCase() === "any") return "0.0.0.0";
  return trimmed;
}

export function isWslHelperName(executable: string | undefined): boolean {
  if (!executable) return false;
  const name = executable.replace(/\.exe$/i, "").toLowerCase();
  return (
    name === "wslrelay" ||
    name === "wslhost" ||
    name === "wsl" ||
    name === "vmcompute" ||
    name === "vmwp" ||
    name === "vmmem" ||
    name === "vmmemwsl" ||
    name === "hns"
  );
}

export function isHyperVHelperName(executable: string | undefined): boolean {
  if (!executable) return false;
  const name = executable.replace(/\.exe$/i, "").toLowerCase();
  return name === "vmwp" || name === "vmcompute" || name === "vmmem" || name === "hns";
}
