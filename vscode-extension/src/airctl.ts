import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
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
  stopped: Array<{ pid: number; signal: string }>;
}

function resolveCommand(): { cmd: string; args: string[]; shell: boolean } {
  const configured = vscode.workspace.getConfiguration("airctl").get<string>("path", "");
  if (configured) {
    return { cmd: configured, args: [], shell: true };
  }

  // Check relative to extension install dir (works when developing in-repo)
  const candidates = [join(__dirname, "..", "..", "dist", "cli.js")];

  // Check workspace folders for an airctl project with a built CLI
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    candidates.push(join(folder.uri.fsPath, "dist", "cli.js"));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { cmd: process.execPath, args: [candidate], shell: false };
    }
  }

  return { cmd: "airctl", args: [], shell: true };
}

function run(args: string[]): Promise<string> {
  const { cmd, args: prefix, shell } = resolveCommand();
  return new Promise((resolve, reject) => {
    execFile(cmd, [...prefix, ...args], { timeout: 15_000, shell }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr?.trim() || error.message;
        reject(new Error(msg));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function getStatus(): Promise<StatusResult> {
  const raw = await run(["status", "--all", "--json"]);
  return JSON.parse(raw);
}

export async function explainPort(port: number): Promise<PortExplanation> {
  const raw = await run(["explain", `:${port}`, "--json"]);
  return JSON.parse(raw);
}

export async function stopProcess(pid: number): Promise<StopResult> {
  const raw = await run(["stop", String(pid), "--yes", "--json"]);
  return JSON.parse(raw);
}
