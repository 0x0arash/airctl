import path from "node:path";
import type { ProcessInfo, Project, Service, Snapshot } from "../domain/types.js";
import { formatAge } from "../runtime/clock.js";
import { formatEndpoint } from "../network/parse.js";
import { isDevelopmentInterest } from "../classification/classify.js";
import { createPalette, statusGlyph, type Palette } from "./color.js";
import type { EnvProvider } from "../runtime/env.js";
import { formatConfidence } from "../engine/explain.js";

export function formatStatus(
  snapshot: Snapshot,
  options: {
    env: EnvProvider;
    tty: boolean;
    all: boolean;
    project?: string;
    quiet: boolean;
    nowMs: number;
  },
): string {
  const palette = createPalette(options.env, options.tty);
  const services = visibleServices(snapshot, options.all, options.project);
  const summary = snapshot.summary;
  const lines: string[] = [];
  if (!options.quiet) {
    lines.push(palette.bold("AIRCTL — LOCAL DEVELOPMENT"));
    lines.push("");
    lines.push(`${summary.services} services`);
    lines.push(`${summary.healthy} healthy`);
    if (summary.stopped) lines.push(`${summary.stopped} stopped`);
    if (summary.orphaned) lines.push(`${summary.orphaned} orphaned`);
    if (summary.unhealthy) lines.push(`${summary.unhealthy} unhealthy`);
    if (summary.warning)
      lines.push(`${summary.warning} warning${summary.warning === 1 ? "" : "s"}`);
    lines.push("");
  }
  lines.push(pad("PROJECT", 18) + pad("SERVICE", 16) + pad("PORT", 12) + "STATUS");
  lines.push("");
  if (services.length === 0) {
    lines.push(palette.dim("No development services discovered. Try --all."));
    return lines.join("\n");
  }
  for (const row of services) {
    const project = snapshot.projects.find((p) => p.id === row.projectId)?.name ?? "—";
    const port = primaryPort(snapshot, row);
    lines.push(
      pad(project, 18) +
        pad(row.name, 16) +
        pad(port === undefined ? "—" : String(port), 12) +
        statusGlyph(row.health, palette),
    );
  }
  const publicWarnings = snapshot.warnings.filter((w) => w.kind === "public-bind");
  if (publicWarnings.length > 0) {
    lines.push("");
    for (const warning of publicWarnings) {
      lines.push(palette.yellow("⚠ PUBLIC INTERFACE"));
      lines.push(warning.detail);
    }
  }
  void options.nowMs;
  return lines.join("\n");
}

export function formatServices(
  snapshot: Snapshot,
  all: boolean,
  project: string | undefined,
  palette: Palette,
): string {
  const services = visibleServices(snapshot, all, project);
  const lines = [
    pad("SERVICE", 20) + pad("CLASS", 20) + pad("PORT", 10) + pad("PID", 8) + "HEALTH",
  ];
  for (const service of services) {
    const port = primaryPort(snapshot, service);
    lines.push(
      pad(service.name, 20) +
        pad(service.classification, 20) +
        pad(port === undefined ? "—" : String(port), 10) +
        pad(service.processId === undefined ? "—" : String(service.processId), 8) +
        statusGlyph(service.health, palette),
    );
  }
  return lines.join("\n");
}

export function formatProjects(projects: Project[], snapshot: Snapshot): string {
  if (projects.length === 0) return "No projects detected.";
  const lines = [pad("PROJECT", 20) + pad("SERVICES", 10) + "ROOT"];
  for (const project of projects) {
    const count = snapshot.services.filter((s) => s.projectId === project.id).length;
    lines.push(pad(project.name, 20) + pad(String(count), 10) + project.root);
  }
  return lines.join("\n");
}

export function formatGraph(snapshot: Snapshot): string {
  const lines: string[] = [];
  const byProject = new Map<string, Service[]>();
  const ungrouped: Service[] = [];
  for (const service of snapshot.services.filter((s) => s.classification !== "system-service")) {
    if (!service.projectId) {
      ungrouped.push(service);
      continue;
    }
    const list = byProject.get(service.projectId) ?? [];
    list.push(service);
    byProject.set(service.projectId, list);
  }
  for (const project of snapshot.projects) {
    const group = byProject.get(project.id);
    if (!group?.length) continue;
    lines.push(project.name.toUpperCase());
    lines.push("│");
    group.forEach((service, index) => {
      const last = index === group.length - 1;
      const branch = last ? "└──" : "├──";
      const port = primaryPort(snapshot, service);
      const fw = service.framework
        ? `  (${service.framework.name}, ${formatConfidence(service.framework.confidence)})`
        : "";
      lines.push(
        `${branch} ${service.name}${port !== undefined ? `    localhost:${port}` : ""}${fw}`,
      );
    });
    lines.push("");
  }
  if (ungrouped.length > 0) {
    lines.push("UNGROUPED");
    for (const service of ungrouped) {
      const port = primaryPort(snapshot, service);
      lines.push(`└── ${service.name}${port !== undefined ? `    localhost:${port}` : ""}`);
    }
  }
  const inferred = snapshot.graph.edges.filter((e) => e.kind === "inferred");
  if (inferred.length > 0) {
    lines.push("", "Inferred relationships:");
    for (const edge of inferred) {
      const from = snapshot.graph.nodes.find((n) => n.id === edge.from)?.label ?? edge.from;
      const to = snapshot.graph.nodes.find((n) => n.id === edge.to)?.label ?? edge.to;
      lines.push(`  ${from} → ${to}  (${edge.reason})`);
    }
  }
  return lines.join("\n").trim() || "No topology yet.";
}

export function formatInspect(
  proc: ProcessInfo,
  snapshot: Snapshot,
  nowMs: number,
  palette: Palette,
): string {
  const project = proc.cwd
    ? snapshot.projects.find((p) => proc.cwd === p.root || proc.cwd?.startsWith(p.root + path.sep))
    : undefined;
  const sockets = snapshot.sockets.filter((s) => s.pid === proc.pid);
  const lines = [
    palette.bold(`PID ${proc.pid}`),
    "",
    `Executable:  ${proc.executable ?? "unknown"}`,
    proc.executablePath ? `Path:        ${proc.executablePath}` : undefined,
    proc.command ? `Command:     ${proc.command}` : undefined,
    proc.cwd ? `Cwd:         ${proc.cwd}` : "Cwd:         unavailable",
    proc.user ? `User:        ${proc.user}` : undefined,
    proc.parentPid !== undefined ? `Parent:      ${proc.parentPid}` : undefined,
    formatAge(proc.startedAt, nowMs)
      ? `Started:     ${formatAge(proc.startedAt, nowMs)}`
      : undefined,
    proc.memoryBytes !== undefined ? `Memory:      ${formatBytes(proc.memoryBytes)}` : undefined,
    project ? `Project:     ${project.name} (${project.root})` : undefined,
    "",
    "Listeners:",
    ...(sockets.length > 0
      ? sockets.map((s) => `  ${formatEndpoint(s.address, s.port)}  ${s.scope}`)
      : ["  none"]),
  ];
  return lines.filter((l): l is string => l !== undefined).join("\n");
}

export function snapshotToJson(snapshot: Snapshot, all: boolean, project?: string): unknown {
  const services = visibleServices(snapshot, all, project).map((s) => ({
    id: s.id,
    name: s.name,
    projectId: s.projectId ?? null,
    processId: s.processId ?? null,
    ports: portsOf(snapshot, s),
    classification: s.classification,
    confidence: s.confidence,
    health: s.health,
    framework: s.framework ?? null,
    evidenceKind: s.evidenceKind,
  }));
  return {
    version: 1,
    scannedAt: snapshot.scannedAt,
    durationMs: snapshot.durationMs,
    summary: snapshot.summary,
    services,
    projects: snapshot.projects.map((p) => ({
      id: p.id,
      name: p.name,
      root: p.root,
      kind: p.kind ?? null,
    })),
    warnings: snapshot.warnings.map((w) => ({
      id: w.id,
      kind: w.kind,
      severity: w.severity,
      title: w.title,
      detail: w.detail,
      related: w.related,
    })),
    capabilities: snapshot.capabilities,
    events: snapshot.events,
  };
}

export function visibleServices(snapshot: Snapshot, all: boolean, project?: string): Service[] {
  let services = snapshot.services;
  if (!all)
    services = services.filter(
      (s) => s.classification !== "system-service" || isDevelopmentInterest(s),
    );
  if (project) {
    const needle = project.toLowerCase();
    services = services.filter((s) => {
      const proj = snapshot.projects.find((p) => p.id === s.projectId);
      return proj?.name.toLowerCase() === needle || proj?.root.toLowerCase().includes(needle);
    });
  }
  return services.sort((a, b) => a.name.localeCompare(b.name));
}

function primaryPort(snapshot: Snapshot, service: Service): number | undefined {
  return portsOf(snapshot, service)[0];
}

function portsOf(snapshot: Snapshot, service: Service): number[] {
  return snapshot.sockets.filter((s) => service.socketIds.includes(s.id)).map((s) => s.port);
}

function pad(value: string, width: number): string {
  if (value.length >= width) return `${value.slice(0, width - 1)} `;
  return value + " ".repeat(width - value.length);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
