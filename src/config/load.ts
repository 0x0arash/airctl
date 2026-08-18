import path from "node:path";
import type { FileSystemProvider } from "../runtime/fs.js";
import { expandHome } from "../projects/detect.js";
import { DEFAULT_UI_PORT } from "../version.js";

export interface AirCtlConfig {
  scan: {
    interval: "adaptive" | number;
  };
  health: {
    enabled: boolean;
  };
  projects: {
    roots: string[];
  };
  ui: {
    openBrowser: boolean;
    port: number;
    bind: string;
  };
  security: {
    bind: string;
  };
  events: {
    limit: number;
  };
}

export const defaultConfig: AirCtlConfig = {
  scan: { interval: "adaptive" },
  health: { enabled: true },
  projects: { roots: [] },
  ui: { openBrowser: true, port: DEFAULT_UI_PORT, bind: "127.0.0.1" },
  security: { bind: "127.0.0.1" },
  events: { limit: 200 },
};

export function configDir(home: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return path.join(home, "AppData", "Local", "airctl");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "airctl");
  }
  return path.join(home, ".config", "airctl");
}

export async function loadConfig(
  fs: FileSystemProvider,
  home: string,
  platform: NodeJS.Platform,
  explicitPath?: string,
): Promise<{ config: AirCtlConfig; path?: string }> {
  const candidates = explicitPath
    ? [explicitPath]
    : [
        path.join(process.cwd(), "airctl.yaml"),
        path.join(process.cwd(), "airctl.yml"),
        path.join(process.cwd(), "airctl.json"),
        path.join(configDir(home, platform), "config.yaml"),
        path.join(configDir(home, platform), "config.yml"),
        path.join(configDir(home, platform), "config.json"),
      ];

  for (const candidate of candidates) {
    const text = await fs.readFile(candidate);
    if (text === undefined) continue;
    const parsed = parseConfigText(text, candidate);
    return { config: mergeConfig(defaultConfig, parsed, home), path: candidate };
  }
  return { config: defaultConfig };
}

export function parseConfigText(text: string, filePath: string): Partial<AirCtlConfig> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (filePath.endsWith(".json") || trimmed.startsWith("{")) {
    return parseJsonConfig(trimmed);
  }
  return parseSimpleYaml(trimmed);
}

function parseJsonConfig(text: string): Partial<AirCtlConfig> {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null) return {};
  return raw as Partial<AirCtlConfig>;
}

export function parseSimpleYaml(text: string): Partial<AirCtlConfig> {
  const result: Record<string, unknown> = {};
  let current: Record<string, unknown> = result;
  let currentKey: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "");
    if (!line.trim()) continue;
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    if (indent === 0 && line.trim().endsWith(":")) {
      currentKey = line.trim().slice(0, -1);
      current = {};
      result[currentKey] = current;
      continue;
    }
    const listMatch = /^\s*-\s+(.*)$/.exec(line);
    if (listMatch && currentKey) {
      const bucket = result[currentKey];
      if (bucket && typeof bucket === "object") {
        const obj = bucket as Record<string, unknown>;
        const lastKey = Object.keys(obj).at(-1);
        if (lastKey && !Array.isArray(obj[lastKey])) {
          obj[lastKey] = [];
        }
        const arr = (lastKey ? obj[lastKey] : obj.roots) as unknown;
        if (Array.isArray(arr)) arr.push(unquote(listMatch[1] ?? ""));
        else obj.roots = [unquote(listMatch[1] ?? "")];
      }
      continue;
    }
    const kv = /^\s*([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (kv) {
      const key = kv[1] ?? "";
      const value = unquote(kv[2] ?? "");
      current[key] = coerce(value);
    }
  }
  return result as Partial<AirCtlConfig>;
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function coerce(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "adaptive") return "adaptive";
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  return value;
}

export function mergeConfig(
  base: AirCtlConfig,
  partial: Partial<AirCtlConfig>,
  home: string,
): AirCtlConfig {
  const roots = (partial.projects?.roots ?? base.projects.roots).map((r) => expandHome(r, home));
  return {
    scan: { ...base.scan, ...partial.scan },
    health: { ...base.health, ...partial.health },
    projects: { roots },
    ui: { ...base.ui, ...partial.ui },
    security: { ...base.security, ...partial.security },
    events: { ...base.events, ...partial.events },
  };
}

export function formatConfig(config: AirCtlConfig): string {
  return [
    "scan:",
    `  interval: ${config.scan.interval}`,
    "health:",
    `  enabled: ${config.health.enabled}`,
    "projects:",
    "  roots:",
    ...(config.projects.roots.length > 0
      ? config.projects.roots.map((r) => `    - ${r}`)
      : ["    # none"]),
    "ui:",
    `  openBrowser: ${config.ui.openBrowser}`,
    `  port: ${config.ui.port}`,
    `  bind: ${config.ui.bind}`,
    "security:",
    `  bind: ${config.security.bind}`,
  ].join("\n");
}
