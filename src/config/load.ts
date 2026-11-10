import { AirCtlError } from "../domain/errors.js";
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
  if (explicitPath) {
    throw new AirCtlError("INVALID_INPUT", `Cannot read config file: ${explicitPath}`);
  }
  return { config: defaultConfig };
}

export function parseConfigText(text: string, filePath: string): Partial<AirCtlConfig> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    const parsed =
      filePath.endsWith(".json") || trimmed.startsWith("{")
        ? (JSON.parse(trimmed) as unknown)
        : parseSimpleYaml(trimmed);
    validateConfig(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof AirCtlError) throw error;
    throw new AirCtlError(
      "INVALID_INPUT",
      `Invalid configuration in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function parseSimpleYaml(text: string): Partial<AirCtlConfig> {
  const result: Record<string, unknown> = {};
  let section: Record<string, unknown> | undefined;
  let listKey: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    let quote = "";
    let line = "";
    for (const char of rawLine) {
      if ((char === '"' || char === "'") && (!quote || quote === char)) quote = quote ? "" : char;
      if (char === "#" && !quote) break;
      line += char;
    }
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      const top = /^([A-Za-z]+):\s*$/.exec(line);
      if (!top) throw new AirCtlError("INVALID_INPUT", `Expected a configuration section: ${line}`);
      section = {};
      result[top[1]!] = section;
      listKey = undefined;
      continue;
    }
    if (!section) throw new AirCtlError("INVALID_INPUT", "Configuration values require a section.");
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (section[listKey] as unknown[]).push(unquote(item[1]!));
      continue;
    }
    const pair = /^\s+([A-Za-z]+):\s*(.*?)\s*$/.exec(line);
    if (!pair) throw new AirCtlError("INVALID_INPUT", `Invalid configuration line: ${line}`);
    const [, key, value] = pair;
    listKey = key === "roots" && !value ? key : undefined;
    section[key!] = listKey
      ? []
      : value!.startsWith('"') || value!.startsWith("'")
        ? unquote(value!)
        : value === "[]"
          ? []
          : coerce(value!);
  }
  return result as Partial<AirCtlConfig>;
}

const object = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input);
const integer = (input: unknown, min: number, max: number): boolean =>
  Number.isInteger(input) && Number(input) >= min && Number(input) <= max;
const loopback = (input: unknown): boolean =>
  typeof input === "string" && ["127.0.0.1", "localhost", "::1"].includes(input);

function validateConfig(value: unknown): asserts value is Partial<AirCtlConfig> {
  const schema: Record<string, Record<string, (input: unknown) => boolean>> = {
    scan: { interval: (input) => input === "adaptive" || integer(input, 1000, 2147483647) },
    health: { enabled: (input) => typeof input === "boolean" },
    projects: {
      roots: (input) =>
        Array.isArray(input) &&
        input.every((root) => typeof root === "string" && root.trim().length > 0),
    },
    ui: {
      openBrowser: (input) => typeof input === "boolean",
      port: (input) => integer(input, 1, 65535),
      bind: loopback,
    },
    security: { bind: loopback },
    events: { limit: (input) => integer(input, 1, 10000) },
  };
  if (!object(value)) throw new AirCtlError("INVALID_INPUT", "Configuration must be an object.");
  for (const [section, settings] of Object.entries(value)) {
    const rules = Object.hasOwn(schema, section) ? schema[section] : undefined;
    if (!rules || !object(settings))
      throw new AirCtlError("INVALID_INPUT", `Invalid configuration section: ${section}`);
    for (const [key, setting] of Object.entries(settings)) {
      if (!Object.hasOwn(rules, key) || !rules[key]!(setting))
        throw new AirCtlError("INVALID_INPUT", `Invalid configuration value: ${section}.${key}`);
    }
  }
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.startsWith("'") ? v.slice(1, -1).replaceAll("''", "'") : (JSON.parse(v) as string);
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
  validateConfig(partial);
  if (partial.ui?.bind && partial.security?.bind && partial.ui.bind !== partial.security.bind) {
    throw new AirCtlError("INVALID_INPUT", "ui.bind and security.bind must agree.");
  }
  const bind = partial.security?.bind ?? partial.ui?.bind ?? base.security.bind;
  const roots = (partial.projects?.roots ?? base.projects.roots).map((r) => expandHome(r, home));
  return {
    scan: { ...base.scan, ...partial.scan },
    health: { ...base.health, ...partial.health },
    projects: { roots },
    ui: { ...base.ui, ...partial.ui, bind },
    security: { ...base.security, ...partial.security, bind },
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
      ? config.projects.roots.map((r) => `    - '${r.replaceAll("'", "''")}'`)
      : ["    # none"]),
    "ui:",
    `  openBrowser: ${config.ui.openBrowser}`,
    `  port: ${config.ui.port}`,
    "security:",
    `  bind: ${config.security.bind}`,
    "events:",
    `  limit: ${config.events.limit}`,
  ].join("\n");
}
