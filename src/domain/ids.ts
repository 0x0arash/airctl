import { createHash } from "node:crypto";
import type { AddressFamily, Port, ProcessId, TransportProtocol } from "./types.js";

export function projectIdFor(root: string): string {
  return `proj_${sha16(normalizeKey(root))}`;
}

export function socketIdFor(input: {
  family: AddressFamily;
  address: string;
  port: Port;
  protocol: TransportProtocol;
}): string {
  return `sock_${input.protocol}_${input.family}_${input.address}_${input.port}`;
}

export function serviceIdFor(input: {
  pid?: ProcessId;
  port?: Port;
  name: string;
  projectId?: string;
}): string {
  const key = [input.projectId ?? "", input.pid ?? "", input.port ?? "", input.name].join(":");
  return `svc_${sha16(key)}`;
}

export function warningIdFor(kind: string, key: string): string {
  return `warn_${sha16(`${kind}:${key}`)}`;
}

export function eventIdFor(at: string, type: string, key: string): string {
  return `evt_${sha16(`${at}:${type}:${key}`)}`;
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizeKey(root: string): string {
  return root.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}
