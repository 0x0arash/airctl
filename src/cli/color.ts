import { colorEnabled, type EnvProvider } from "../runtime/env.js";

export interface Palette {
  enabled: boolean;
  bold(s: string): string;
  dim(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  red(s: string): string;
  cyan(s: string): string;
  amber(s: string): string;
}

export function createPalette(env: EnvProvider, stdoutIsTty: boolean): Palette {
  const enabled = colorEnabled(env, stdoutIsTty);
  const wrap = (code: string) => (s: string) => (enabled ? `\u001b[${code}m${s}\u001b[0m` : s);
  return {
    enabled,
    bold: wrap("1"),
    dim: wrap("2"),
    green: wrap("32"),
    yellow: wrap("33"),
    red: wrap("31"),
    cyan: wrap("36"),
    amber: wrap("33"),
  };
}

export function statusGlyph(health: string, palette: Palette): string {
  switch (health) {
    case "healthy":
    case "running":
      return palette.green("●") + " " + health;
    case "unhealthy":
      return palette.red("●") + " unhealthy";
    case "orphaned":
      return palette.yellow("⚠") + " orphaned";
    case "stopped":
      return palette.dim("○") + " stopped";
    default:
      return palette.dim("○") + " " + health;
  }
}
