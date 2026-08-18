import { randomBytes } from "node:crypto";
import type { Snapshot } from "../domain/types.js";

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string };
}

export interface StatusResponse {
  version: 1;
  scannedAt: string;
  durationMs: number;
  summary: Snapshot["summary"];
  capabilities: Snapshot["capabilities"];
}

export interface StopRequest {
  force?: boolean;
}

export function newRequestId(): string {
  return randomBytes(8).toString("hex");
}

export function newAuthToken(): string {
  return randomBytes(24).toString("hex");
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.replace(/:\d+$/, "").replace(/^\[/, "").replace(/\]$/, "");
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

export function originAllowed(origin: string | undefined, bindHost: string, port: number): boolean {
  if (!origin) return true;
  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
    `http://${bindHost}:${port}`,
  ]);
  return allowed.has(origin);
}
