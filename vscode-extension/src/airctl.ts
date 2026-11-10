import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

export interface StatusSummary {
  services: number;
  healthy: number;
  unhealthy: number;
  stopped: number;
  warning: number;
  unknown: number;
  orphaned: number;
}

export interface ServiceEntry {
  id: string;
  name: string;
  projectId: string | null;
  processId: number | null;
  ports: number[];
  classification: string;
  confidence: number;
  health: string;
  framework: { name: string; confidence: number; evidence: string[] } | null;
  evidenceKind: string;
}

export interface ProjectEntry {
  id: string;
  root: string;
  name: string;
  markers: string[];
}

export interface StatusResult {
  version: number;
  scannedAt: string;
  durationMs: number;
  summary: StatusSummary;
  services: ServiceEntry[];
  projects: ProjectEntry[];
}

export interface PortExplanation {
  port: number;
  occupied: boolean;
  process?: { pid: number; executable?: string; command?: string; cwd?: string };
  project?: { name: string; root: string };
  service?: { name: string; health: string };
  classification?: string;
  likelyIssue?: string;
  actions: string[];
}

export interface StopResult {
  stopped: Array<{ pid: number; stopped: boolean; signal: string }>;
}

function resolveCommand(): { cmd: string; args: string[]; shell: boolean } {
  const configured = vscode.workspace.getConfiguration("airctl").get<string>("path", "");
  if (configured) {
    if (process.platform === "win32" && /["%\r\n]/.test(configured)) {
      throw new Error("airctl.path contains characters unsupported by Windows command shims.");
    }
    return {
      cmd:
        process.platform === "win32" && /\.cmd$/i.test(configured) ? `"${configured}"` : configured,
      args: [],
      shell: process.platform === "win32" && /\.cmd$/i.test(configured),
    };
  }

  // Check relative to extension install dir (works when developing in-repo)
  const candidates = [join(__dirname, "..", "..", "dist", "cli.js")];

  for (const candidate of candidates) {
    if (existsSync(candidate) && isAirCtlCheckout(join(candidate, "..", "..", "package.json"))) {
      return { cmd: process.execPath, args: [candidate], shell: false };
    }
  }

  return {
    cmd: process.platform === "win32" ? "airctl.cmd" : "airctl",
    args: [],
    shell: process.platform === "win32",
  };
}

function isAirCtlCheckout(manifest: string): boolean {
  try {
    return JSON.parse(readFileSync(manifest, "utf8")).name === "airctl";
  } catch {
    return false;
  }
}

function run(args: string[], allowedExitCodes: number[] = []): Promise<string> {
  const { cmd, args: prefix, shell } = resolveCommand();
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      [...prefix, ...args],
      {
        timeout: 15_000,
        shell,
        env: prefix.length ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env,
      },
      (error, stdout, stderr) => {
        if (error && !allowedExitCodes.includes(Number(error.code))) {
          const msg = stderr?.trim() || error.message;
          reject(new Error(msg));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

let pendingStatus: Promise<StatusResult> | undefined;

export function getStatus(): Promise<StatusResult> {
  pendingStatus ??= run(["status", "--all", "--json"])
    .then((raw) => JSON.parse(raw) as StatusResult)
    .finally(() => {
      pendingStatus = undefined;
    });
  return pendingStatus;
}

export async function explainPort(port: number): Promise<PortExplanation> {
  const raw = await run(["explain", `:${port}`, "--json"], [3]);
  return JSON.parse(raw);
}

export async function stopProcess(pid: number): Promise<StopResult> {
  const raw = await run(["stop", String(pid), "--yes", "--json"], [7]);
  return JSON.parse(raw);
}
