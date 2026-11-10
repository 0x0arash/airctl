import type { Service, StatusSummary, Warning } from "./types.js";

export function summarize(services: Service[], warnings: Warning[]): StatusSummary {
  return {
    services: services.length,
    healthy: services.filter((s) => s.health === "healthy").length,
    running: services.filter((s) => s.health === "running").length,
    unhealthy: services.filter((s) => s.health === "unhealthy").length,
    stopped: services.filter((s) => s.health === "stopped").length,
    warning: warnings.length,
    unknown: services.filter((s) => s.health === "unknown").length,
    orphaned: services.filter((s) => s.health === "orphaned").length,
  };
}
