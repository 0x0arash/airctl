import type { ProcessInfo, Project } from "../domain/types.js";

export interface DetectionContext {
  process: ProcessInfo;
  project?: Project;
  ports: number[];
  command: string;
  executable: string;
}

export interface DetectionHit {
  name: string;
  confidence: number;
  evidence: string[];
  classification?:
    | "development-server"
    | "database"
    | "cache"
    | "container"
    | "system-service"
    | "proxy"
    | "unknown";
}

export interface Detector {
  id: string;
  detect(ctx: DetectionContext): DetectionHit | undefined;
}

export function score(...parts: Array<number | undefined>): number {
  const values = parts.filter((p): p is number => p !== undefined);
  if (values.length === 0) return 0;
  const max = Math.max(...values);
  const extra = values.reduce((a, b) => a + b, 0) - max;
  return Math.min(0.99, max + extra * 0.08);
}
