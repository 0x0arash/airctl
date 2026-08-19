import packageJson from "../package.json" with { type: "json" };

export const VERSION = packageJson.version;
export const APP_NAME = "airctl";
export const USER_AGENT = `AirCtl/${VERSION} (local-health-check)`;
export const DEFAULT_UI_PORT = 4114;
export const API_VERSION = `v${Math.max(Number(packageJson.version.split(".")[0] ?? 0), 1)}`;
