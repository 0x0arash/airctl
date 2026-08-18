export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  level: LogLevel;
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

export function createLogger(
  level: LogLevel,
  json: boolean,
  sink: (line: string) => void = writeStderr,
): Logger {
  const emit = (lvl: LogLevel, message: string, extra?: Record<string, unknown>): void => {
    if (RANK[lvl] < RANK[level]) return;
    if (json) {
      sink(JSON.stringify({ level: lvl, msg: message, ...redactExtra(extra) }));
      return;
    }
    if (lvl === "debug") sink(`dbg ${message}`);
    else if (lvl === "warn") sink(`warn ${message}`);
    else if (lvl === "error") sink(`error ${message}`);
  };
  return {
    level,
    debug: (m, e) => emit("debug", m, e),
    info: (m, e) => emit("info", m, e),
    warn: (m, e) => emit("warn", m, e),
    error: (m, e) => emit("error", m, e),
  };
}

function redactExtra(extra?: Record<string, unknown>): Record<string, unknown> {
  if (!extra) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (/secret|token|password|authorization/i.test(k)) out[k] = "***";
    else out[k] = v;
  }
  return out;
}

function writeStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}
