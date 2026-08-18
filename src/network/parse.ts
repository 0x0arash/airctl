import type { AddressFamily, BindScope, Port } from "../domain/types.js";

export interface ParsedEndpoint {
  address: string;
  port: Port;
  family: AddressFamily;
  bindAddress: string;
}

const PORT_RE = /^\d+$/;

export function parsePort(value: string | number): Port {
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid port: ${String(value)}`);
  }
  return n;
}

export function parsePortArg(raw: string): Port {
  const trimmed = raw.trim();
  const withoutColon = trimmed.startsWith(":") ? trimmed.slice(1) : trimmed;
  if (!PORT_RE.test(withoutColon)) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return parsePort(withoutColon);
}

export function isLoopbackAddress(address: string): boolean {
  const lower = stripZone(address).toLowerCase();
  if (lower === "localhost" || lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("127.")) return true;
  return false;
}

export function isUnspecifiedAddress(address: string): boolean {
  const lower = stripZone(address).toLowerCase();
  return (
    lower === "0.0.0.0" || lower === "::" || lower === "0000:0000:0000:0000:0000:0000:0000:0000"
  );
}

export function bindScope(address: string): BindScope {
  const ip = stripZone(address);
  if (isUnspecifiedAddress(ip)) return "unspecified";
  if (isLoopbackAddress(ip)) return "loopback";
  if (isPrivateAddress(ip)) return "private";
  return "public";
}

export function isPrivateAddress(address: string): boolean {
  const ip = stripZone(address);
  if (isIPv4(ip)) {
    const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}

export function formatEndpoint(address: string, port: Port): string {
  if (isIPv6(address)) return `[${address}]:${port}`;
  return `${address}:${port}`;
}

export function parseEndpoint(value: string): ParsedEndpoint {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end < 0) throw new Error(`Invalid endpoint: ${value}`);
    const address = trimmed.slice(1, end);
    const rest = trimmed.slice(end + 1);
    if (!rest.startsWith(":")) throw new Error(`Invalid endpoint: ${value}`);
    const port = parsePort(rest.slice(1));
    return { address, port, family: "ipv6", bindAddress: address };
  }
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon < 0) throw new Error(`Invalid endpoint: ${value}`);
  const host = trimmed.slice(0, lastColon);
  const port = parsePort(trimmed.slice(lastColon + 1));
  if (host.includes(":") && !isIPv4(host)) {
    return { address: host, port, family: "ipv6", bindAddress: host };
  }
  return { address: host, port, family: "ipv4", bindAddress: host };
}

export function isIPv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number.parseInt(part, 10);
    return n >= 0 && n <= 255;
  });
}

export function isIPv6(address: string): boolean {
  if (address.includes(".")) return false;
  return address.includes(":");
}

export function parseHexIPv4(hex: string): string {
  const raw = hex.toLowerCase();
  if (raw.length !== 8) throw new Error(`Invalid IPv4 hex: ${hex}`);
  const bytes = [
    Number.parseInt(raw.slice(6, 8), 16),
    Number.parseInt(raw.slice(4, 6), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(0, 2), 16),
  ];
  if (bytes.some((b) => Number.isNaN(b))) throw new Error(`Invalid IPv4 hex: ${hex}`);
  return bytes.join(".");
}

export function parseHexIPv6(hex: string): string {
  const raw = hex.toLowerCase();
  if (raw.length !== 32) throw new Error(`Invalid IPv6 hex: ${hex}`);
  const groups: string[] = [];
  for (let i = 0; i < 32; i += 8) {
    const chunk = raw.slice(i, i + 8);
    const le = chunk.slice(6, 8) + chunk.slice(4, 6) + chunk.slice(2, 4) + chunk.slice(0, 2);
    groups.push(le.slice(0, 4), le.slice(4, 8));
  }
  return compressIPv6(groups.map((g) => g.replace(/^0+/, "") || "0").join(":"));
}

export function parseHexPort(hex: string): Port {
  const port = Number.parseInt(hex, 16);
  return parsePort(port);
}

export function compressIPv6(address: string): string {
  const lower = address.toLowerCase();
  if (lower === "0000:0000:0000:0000:0000:0000:0000:0001" || lower === "0:0:0:0:0:0:0:1") {
    return "::1";
  }
  const parts = lower.split(":");
  if (parts.length !== 8) return lower;
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] === "0") {
      if (curStart === -1) curStart = i;
      curLen += 1;
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return parts.join(":");
  const head = parts.slice(0, bestStart).join(":");
  const tail = parts.slice(bestStart + bestLen).join(":");
  return `${head}::${tail}`;
}

export function normalizeIPv6(address: string): string {
  return compressIPv6(expandIPv6(address));
}

export function expandIPv6(address: string): string {
  const ip = stripZone(address).toLowerCase();
  if (ip === "::") return "0:0:0:0:0:0:0:0";
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  if (!ip.includes("::")) {
    return ip.split(":").map(pad4).join(":");
  }
  const missing = 8 - headParts.length - tailParts.length;
  const zeros = Array.from({ length: missing }, () => "0");
  return [...headParts, ...zeros, ...tailParts].map(pad4).join(":");
}

function pad4(part: string): string {
  return (part || "0").replace(/^0+/, "") || "0";
}

function stripZone(address: string): string {
  const pct = address.indexOf("%");
  return pct >= 0 ? address.slice(0, pct) : address;
}

export function familyOf(address: string): AddressFamily {
  return isIPv6(address) || address === "::" || address.includes(":") ? "ipv6" : "ipv4";
}
