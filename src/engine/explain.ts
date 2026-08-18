import { formatAge } from "../runtime/clock.js";
import { formatEndpoint } from "../network/parse.js";
import type { PortExplanation } from "../domain/types.js";

export function formatExplanation(expl: PortExplanation, nowMs: number): string {
  const lines = [`PORT ${expl.port}`, "────────────────────────────", ""];
  if (!expl.occupied) {
    lines.push("○ FREE", "", "No process is listening on this port.");
    return lines.join("\n");
  }
  lines.push("● OCCUPIED", "");
  if (expl.process) {
    lines.push("Process:");
    lines.push(`  ${expl.process.executable ?? expl.process.executablePath ?? "unknown"}`);
    lines.push(`  PID ${expl.process.pid}`);
    if (!expl.process.executable && !expl.process.executablePath) {
      lines.push("  (process name unavailable — common for Docker port proxies on Windows)");
    }
    lines.push("");
  }
  if (expl.project) {
    lines.push("Project:");
    lines.push(`  ${expl.project.root}`);
    lines.push("");
  }
  if (expl.process?.command) {
    lines.push("Command:");
    lines.push(`  ${expl.process.command}`);
    lines.push("");
  }
  const age = formatAge(expl.process?.startedAt, nowMs);
  if (age) {
    lines.push("Started:");
    lines.push(`  ${age}`);
    lines.push("");
  }
  if (expl.sockets[0]) {
    lines.push("Listener:");
    for (const socket of expl.sockets) {
      const label = formatEndpoint(socket.address, socket.port);
      const warn =
        socket.scope === "unspecified" || socket.scope === "public" ? "  ⚠ public interface" : "";
      lines.push(`  ${label}${warn}`);
    }
    lines.push("");
  }
  if (expl.parent) {
    lines.push("Parent:");
    lines.push(`  ${expl.parent.executable ?? "unknown"}`);
    lines.push("");
  }
  if (expl.classification) {
    lines.push("Classification:");
    lines.push(`  ${humanClass(expl.classification)}`);
    if (expl.confidence !== undefined) {
      lines.push(`  Confidence: ${formatConfidence(expl.confidence)}`);
    }
    if (expl.service?.framework) {
      const label = identityLabel(expl.classification, expl.service.evidenceKind);
      lines.push(`  ${label}: ${expl.service.framework.name}`);
      if (expl.service.evidenceKind === "inferred") {
        lines.push("  Evidence: inferred from well-known port / process signals, not a fact");
      }
    }
    lines.push("");
  }
  if (expl.likelyIssue) {
    lines.push("Likely issue:");
    lines.push(`  ${expl.likelyIssue}`);
    lines.push("");
  }
  if (expl.actions.length > 0) {
    lines.push("Actions:");
    for (const action of expl.actions) lines.push(`  ${action}`);
  }
  return lines.join("\n");
}

export function formatConfidence(value: number): string {
  if (value >= 0.85) return "high";
  if (value >= 0.6) return value.toFixed(2);
  return `low (${value.toFixed(2)})`;
}

function identityLabel(
  classification: string | undefined,
  evidenceKind: string | undefined,
): string {
  if (classification === "development-server") {
    return evidenceKind === "observed" ? "Framework" : "Likely framework";
  }
  return evidenceKind === "observed" ? "Service" : "Likely service";
}

function humanClass(value: string): string {
  return value.replaceAll("-", " ").replace(/^\w/, (c) => c.toUpperCase());
}
