import { VERSION } from "../version.js";
import type { DiscoveryEngine } from "./engine.js";
import type { DoctorReport } from "../domain/types.js";

export async function runDoctor(engine: DiscoveryEngine): Promise<DoctorReport> {
  const snapshot = await engine.scan();
  const caps = snapshot.capabilities;
  const checks = [
    {
      name: "Process discovery",
      ok: caps.processDiscovery.ok,
      limited: caps.processDiscovery.limited,
      detail: caps.processDiscovery.detail,
    },
    {
      name: "Socket discovery",
      ok: caps.socketDiscovery.ok,
      limited: caps.socketDiscovery.limited,
      detail: caps.socketDiscovery.detail,
    },
    {
      name: "Working directories",
      ok: caps.cwdInspection.ok,
      limited: caps.cwdInspection.limited,
      detail: caps.cwdInspection.detail,
    },
    { name: "SQLite", ok: caps.sqlite.ok, detail: caps.sqlite.detail },
    {
      name: "Docker integration",
      ok: caps.docker.ok,
      limited: !caps.docker.ok,
      detail: caps.docker.detail,
    },
    { name: "HTTP health checks", ok: caps.httpHealth.ok, detail: caps.httpHealth.detail },
  ];
  return {
    checks,
    warnings: snapshot.warnings,
    platform: engine.runtime.platform,
    nodeVersion: process.version,
  };
}

export function formatDoctor(report: DoctorReport): string {
  const lines = [
    "AIRCTL DOCTOR",
    `Platform: ${report.platform}    Node: ${report.nodeVersion}    AirCtl: ${VERSION}`,
    "",
  ];
  for (const check of report.checks) {
    const mark = check.ok && !check.limited ? "✓" : check.ok || check.limited ? "⚠" : "✗";
    lines.push(`${mark} ${check.name} — ${check.detail}`);
  }
  if (report.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of report.warnings) {
      lines.push(`⚠ ${warning.title}: ${warning.detail}`);
    }
  } else {
    lines.push("", "No warnings.");
  }
  return lines.join("\n");
}
