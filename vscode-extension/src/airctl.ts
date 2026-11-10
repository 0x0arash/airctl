import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DiscoverySession } from "./session";
import * as vscode from "vscode";

export interface StatusSummary {
  services: number;
  healthy: number;
  running?: number;
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
  capabilities?: { httpHealth?: { ok: boolean; detail?: string } };
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

export function tuiTerminalOptions(): vscode.TerminalOptions {
  const { cmd, args, shell } = resolveCommand();
  return {
    name: "AirCtl",
    shellPath: shell ? (process.env.ComSpec ?? "cmd.exe") : cmd,
    shellArgs: shell ? ["/d", "/s", "/c", `${cmd} tui`] : [...args, "tui"],
    env: args.length ? { ELECTRON_RUN_AS_NODE: "1" } : undefined,
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
          let payload: { error?: { code?: string; message?: string } } = {};
          try {
            payload = JSON.parse(stdout);
          } catch {
            /* Plain stderr from legacy CLIs. */
          }
          const msg = payload.error?.message || stderr?.trim() || error.message;
          reject(Object.assign(new Error(msg), { code: payload.error?.code }));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

let pendingStatus: Promise<StatusResult> | undefined;
let activeSession: DiscoverySession<StatusResult> | undefined;

function oneShotStatus(): Promise<StatusResult> {
  const full = vscode.workspace.getConfiguration("airctl").get<boolean>("detailedDiscovery", false);
  pendingStatus ??= run(full ? ["status", "--json"] : ["status", "--fast", "--json"])
    .catch((error) => {
      if (error.code === "INVALID_INPUT" && /unknown flag:?.*--fast/i.test(error.message))
        return run(["status", "--json"]);
      throw error;
    })
    .then((raw) => JSON.parse(raw) as StatusResult)
    .finally(() => {
      pendingStatus = undefined;
    });
  return pendingStatus;
}

export function getStatus(): Promise<StatusResult> {
  return activeSession ? activeSession.status() : oneShotStatus();
}

export function refreshStatus(): Promise<StatusResult> {
  return activeSession ? activeSession.request("refresh") : oneShotStatus();
}

export function startDiscovery(
  onSnapshot: (status: StatusResult) => void,
  onError: (error: Error) => void,
): vscode.Disposable {
  const config = vscode.workspace.getConfiguration("airctl");
  const configuredInterval = config.get<number>("refreshInterval", 10);
  const intervalMs = Math.max(
    2000,
    Math.min(
      2147483000,
      Math.round((Number.isFinite(configuredInterval) ? configuredInterval : 10) * 1000),
    ),
  );
  const detailed = config.get<boolean>("detailedDiscovery", false);
  let disposed = false;
  let polling: ReturnType<typeof setInterval> | undefined;
  const legacyRefresh = (): void => {
    void oneShotStatus()
      .then((status) => {
        if (!disposed) onSnapshot(status);
      })
      .catch((error) => {
        if (!disposed) onError(error);
      });
  };
  const client = new DiscoverySession<StatusResult>({
    intervalMs,
    requestTimeoutMs: detailed ? 120000 : 30000,
    validate: (value): value is StatusResult =>
      !!value &&
      typeof value === "object" &&
      typeof (value as StatusResult).scannedAt === "string" &&
      Array.isArray((value as StatusResult).services) &&
      !!(value as StatusResult).summary,
    launch: () => {
      const { cmd, args, shell } = resolveCommand();
      return spawn(cmd, [...args, "session", "--json", ...(detailed ? [] : ["--fast"])], {
        stdio: "pipe",
        shell,
        windowsHide: true,
        env: args.length ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env,
      });
    },
    onSnapshot: (status) => {
      if (!disposed) onSnapshot(status);
    },
    onError: (error) => {
      if (disposed) return;
      if (error.unsupported) {
        if (activeSession === client) activeSession = undefined;
        client.dispose();
        legacyRefresh();
        polling = setInterval(legacyRefresh, intervalMs);
      } else onError(error);
    },
  });
  activeSession = client;
  client.start();
  return {
    dispose: () => {
      disposed = true;
      if (polling) clearInterval(polling);
      client.dispose();
      if (activeSession === client) activeSession = undefined;
    },
  };
}

export async function explainPort(port: number): Promise<PortExplanation> {
  if (activeSession) return activeSession.request("explain", { port });
  const raw = await run(["explain", `:${port}`, "--json"], [3]);
  return JSON.parse(raw);
}

export async function stopProcess(pid: number): Promise<StopResult> {
  if (activeSession) return activeSession.request("stop", { pid, confirm: true });
  const raw = await run(["stop", String(pid), "--yes", "--json"], [7]);
  return JSON.parse(raw);
}
