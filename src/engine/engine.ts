import type { Runtime } from "../runtime/index.js";
import type {
  ActivityEvent,
  CapabilityReport,
  ListeningSocket,
  PortExplanation,
  ProcessInfo,
  Project,
  Service,
  Snapshot,
  StatusSummary,
  Warning,
} from "../domain/types.js";
import { AirCtlError } from "../domain/errors.js";
import { eventIdFor } from "../domain/ids.js";
import { describeEvent, type DomainEvent } from "../domain/events.js";
import type { AirCtlConfig } from "../config/load.js";
import { defaultConfig } from "../config/load.js";
import type { ProcessProvider } from "../process/provider.js";
import { PlatformProcessProvider } from "../process/provider.js";
import type { SocketProvider } from "../network/provider.js";
import { PlatformSocketProvider } from "../network/provider.js";
import type { ProjectDetector } from "../projects/detect.js";
import { FilesystemProjectDetector, projectByCwd } from "../projects/detect.js";
import { DetectorRegistry } from "../detectors/registry.js";
import { classifyServices, isDevelopmentInterest } from "../classification/classify.js";
import { ConservativeHealthChecker, type HealthChecker } from "../health/check.js";
import { inferTopology } from "../topology/infer.js";
import { detectOrphans } from "../orphans/detect.js";
import { collectWarnings } from "../warnings/detect.js";
import type { ContainerProvider } from "../docker/provider.js";
import { DockerCliProvider } from "../docker/provider.js";
import type { SnapshotStore } from "../storage/store.js";
import { MemorySnapshotStore } from "../storage/store.js";
import { mapLimit } from "../runtime/limit.js";
import type { ProcessId } from "../domain/types.js";
import { formatEndpoint } from "../network/parse.js";
import { ancestorsOf } from "../process/tree.js";
import { parsePortArg } from "../network/parse.js";
import type { Logger } from "../logging/logger.js";
import { createLogger } from "../logging/logger.js";
import { USER_AGENT } from "../version.js";
import { attachInferredCwds } from "../process/windows.js";
import { enrichWindowsListenerCwds } from "../process/windows-cwd.js";

export interface EngineDeps {
  runtime: Runtime;
  processes?: ProcessProvider;
  sockets?: SocketProvider;
  projects?: ProjectDetector;
  detectors?: DetectorRegistry;
  health?: HealthChecker;
  containers?: ContainerProvider;
  store?: SnapshotStore;
  config?: AirCtlConfig;
  logger?: Logger;
}

export class DiscoveryEngine {
  readonly runtime: Runtime;
  readonly processes: ProcessProvider;
  readonly sockets: SocketProvider;
  readonly projects: ProjectDetector;
  readonly detectors: DetectorRegistry;
  readonly health: HealthChecker;
  readonly containers: ContainerProvider;
  readonly store: SnapshotStore;
  readonly config: AirCtlConfig;
  readonly logger: Logger;
  private snapshot: Snapshot | undefined;
  private listeners = new Set<(snapshot: Snapshot, events: DomainEvent[]) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private scanning = false;
  private idleTicks = 0;

  constructor(deps: EngineDeps) {
    this.runtime = deps.runtime;
    this.processes = deps.processes ?? new PlatformProcessProvider(deps.runtime);
    this.sockets = deps.sockets ?? new PlatformSocketProvider(deps.runtime);
    this.projects = deps.projects ?? new FilesystemProjectDetector(deps.runtime.fs);
    this.detectors = deps.detectors ?? new DetectorRegistry();
    this.health =
      deps.health ??
      new ConservativeHealthChecker({
        enabled: (deps.config ?? defaultConfig).health.enabled,
        tcpTimeoutMs: 400,
        httpTimeoutMs: 1200,
        userAgent: USER_AGENT,
      });
    this.containers = deps.containers ?? new DockerCliProvider(deps.runtime.commands);
    this.store = deps.store ?? new MemorySnapshotStore();
    this.config = deps.config ?? defaultConfig;
    this.logger = deps.logger ?? createLogger("warn", false);
  }

  onChange(listener: (snapshot: Snapshot, events: DomainEvent[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): Snapshot | undefined {
    return this.snapshot;
  }

  async refresh(): Promise<Snapshot> {
    return this.scan();
  }

  async scan(): Promise<Snapshot> {
    if (this.scanning) {
      return this.snapshot ?? this.scanUnsynchronized();
    }
    this.scanning = true;
    try {
      return await this.scanUnsynchronized();
    } finally {
      this.scanning = false;
    }
  }

  private async scanUnsynchronized(): Promise<Snapshot> {
    const started = this.runtime.clock.nowMs();
    const [processRaw, dockerAvail] = await Promise.all([
      this.safe("processes", () => this.processes.listProcesses(), [] as ProcessInfo[]),
      this.safe("docker", () => this.containers.available(), {
        ok: false,
        detail: "Docker integration unavailable",
      }),
    ]);

    let processResult = attachInferredCwds(processRaw);
    const network = await this.safe("sockets", () => this.sockets.discover(processResult), {
      listening: [] as ListeningSocket[],
      connections: [],
    });
    const socketResult = network.listening;
    const connections = network.connections;

    if (this.runtime.platform === "win32") {
      processResult = await this.safe(
        "cwd",
        () => enrichWindowsListenerCwds(this.runtime.commands, processResult, socketResult),
        processResult,
      );
    }

    const containers = dockerAvail.ok
      ? await this.safe("containers", () => this.containers.listContainers(), [])
      : [];

    const projects = await this.safe(
      "projects",
      () => this.projects.detectFromProcesses(processResult, this.config.projects.roots),
      [] as Project[],
    );

    let services = classifyServices({
      processes: processResult,
      sockets: socketResult,
      projects,
      detectors: this.detectors,
    });

    attachContainers(services, socketResult, containers);

    const cwdCache = new Map<string, boolean>();
    for (const proc of processResult) {
      if (!proc.cwd || cwdCache.has(proc.cwd)) continue;
      cwdCache.set(proc.cwd, (await this.runtime.fs.stat(proc.cwd))?.isDirectory === true);
    }
    const orphans = detectOrphans({
      services,
      processes: processResult,
      platform: this.runtime.platform,
      cwdExists: (cwd) => cwdCache.get(cwd) !== false,
    });
    for (const finding of orphans) {
      services = services.map((s) =>
        s.id === finding.serviceId ? { ...s, health: "orphaned", orphanReason: finding.reason } : s,
      );
    }

    const interesting = services.filter((s) => isDevelopmentInterest(s) || s.health === "orphaned");
    await mapLimit(interesting, 8, async (service) => {
      if (service.health === "orphaned") return;
      const socks = socketResult.filter((s) => service.socketIds.includes(s.id));
      try {
        const health = await this.health.check(service, socks);
        service.health = health;
      } catch {
        service.health = "unknown";
      }
    });

    for (const finding of orphans) {
      const svc = services.find((s) => s.id === finding.serviceId);
      if (svc) {
        svc.health = "orphaned";
        svc.orphanReason = finding.reason;
      }
    }

    const wantedPorts = await detectWantedPorts(this.runtime.fs, projects);
    const warnings = collectWarnings({
      services,
      sockets: socketResult,
      processes: processResult,
      projects,
      orphans,
      wantedPorts,
    });

    const graph = inferTopology({
      services: services.filter((s) => s.classification !== "system-service"),
      processes: processResult,
      sockets: socketResult,
      projects,
      containers,
      connections,
    });

    const capabilities = await this.capabilities(processResult, socketResult, dockerAvail);
    const durationMs = this.runtime.clock.nowMs() - started;
    const scannedAt = this.runtime.clock.isoNow();
    const domainEvents = diffSnapshots(this.snapshot, {
      processes: processResult,
      sockets: socketResult,
      projects,
      services,
      warnings,
      scannedAt,
    });

    const activity: ActivityEvent[] = domainEvents.map((event) => ({
      id: eventIdFor(event.at, event.type, describeEvent(event)),
      at: event.at,
      type: event.type,
      message: describeEvent(event),
    }));

    const events = await this.store.appendEvents(activity, this.config.events.limit);

    const snapshot: Snapshot = {
      scannedAt,
      durationMs,
      processes: processResult,
      sockets: socketResult,
      connections,
      projects,
      services,
      warnings,
      graph,
      capabilities,
      summary: summarize(services, warnings),
      events,
    };

    this.snapshot = snapshot;
    await this.store.save(snapshot);
    for (const listener of this.listeners) listener(snapshot, domainEvents);
    this.logger.debug("scan complete", { durationMs, services: services.length });
    if (domainEvents.length === 0) this.idleTicks += 1;
    else this.idleTicks = 0;
    return snapshot;
  }

  async explainPort(portInput: string | number): Promise<PortExplanation> {
    const port = typeof portInput === "number" ? portInput : parsePortArg(String(portInput));
    const snapshot = this.snapshot ?? (await this.scan());
    const sockets = snapshot.sockets.filter((s) => s.port === port);
    if (sockets.length === 0) {
      return {
        port,
        occupied: false,
        sockets: [],
        actions: [`airctl stop is not applicable — port ${port} is free`],
      };
    }
    const primary = sockets[0];
    const processInfo = await this.resolveProcess(snapshot, primary?.pid);
    const service = snapshot.services.find((s) =>
      s.socketIds.some((id) => sockets.some((sock) => sock.id === id)),
    );
    const project =
      service?.projectId !== undefined
        ? snapshot.projects.find((p) => p.id === service.projectId)
        : processInfo
          ? projectByCwd(snapshot.projects, processInfo.cwd)
          : undefined;
    const byPid = new Map(snapshot.processes.map((p) => [p.pid, p]));
    const parent =
      processInfo?.parentPid !== undefined ? byPid.get(processInfo.parentPid) : undefined;

    const likelyIssue = inferIssue(service, processInfo, snapshot, sockets);
    const actions: string[] = [];
    if (processInfo) {
      actions.push(`airctl stop :${port}`);
      actions.push(`airctl stop ${processInfo.pid}`);
      actions.push(`airctl inspect ${processInfo.pid}`);
    }
    if (project) {
      actions.push(`airctl stop ${project.name}`);
      actions.push(`airctl open ${project.name}`);
    }

    return {
      port,
      occupied: true,
      sockets,
      process: processInfo,
      project,
      service,
      parent,
      classification: service?.classification,
      confidence: service?.confidence,
      likelyIssue,
      actions,
    };
  }

  private async resolveProcess(
    snapshot: Snapshot,
    pid: number | undefined,
  ): Promise<ProcessInfo | undefined> {
    if (pid === undefined) return undefined;
    const listed = snapshot.processes.find((p) => p.pid === pid);
    if (listed?.executable || listed?.executablePath) return listed;
    try {
      const live = await this.processes.inspect(pid);
      if (live && live.availability !== "gone") {
        return { ...listed, ...live, pid };
      }
    } catch {
      // Process disappeared between scan and explain — expected.
    }
    return listed ?? { pid, availability: "unknown" };
  }

  async inspectPid(pid: ProcessId): Promise<ProcessInfo> {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new AirCtlError("INVALID_INPUT", `Invalid PID: ${pid}`);
    }
    const live = await this.processes.inspect(pid);
    if (!live || live.availability === "gone") {
      throw new AirCtlError("PROCESS_NOT_FOUND", `Process ${pid} no longer exists.`);
    }
    return live;
  }

  startAdaptiveLoop(): void {
    const tick = async (): Promise<void> => {
      try {
        await this.scan();
      } catch (error) {
        this.logger.warn("scan failed", { error: String(error) });
      }
      const delay = adaptiveDelay(this.config.scan.interval, this.idleTicks);
      this.timer = setTimeout(() => {
        void tick();
      }, delay);
      this.timer.unref?.();
    };
    void tick();
  }

  stopLoop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async close(): Promise<void> {
    this.stopLoop();
    await this.store.close();
  }

  private async capabilities(
    processes: ProcessInfo[],
    sockets: ListeningSocket[],
    dockerAvail: { ok: boolean; detail: string },
  ): Promise<CapabilityReport> {
    const cwdObserved = processes.filter((p) => p.cwd && p.cwdKind !== "inferred").length;
    const cwdInferred = processes.filter((p) => p.cwdKind === "inferred").length;
    const forwarded = sockets.filter((s) => s.forwarded).length;
    const limited = processes.some((p) => p.availability === "permission-limited");
    let cwdDetail = "Working directories unavailable";
    if (cwdObserved > 0 && cwdInferred > 0) {
      cwdDetail = `${cwdObserved} observed, ${cwdInferred} inferred from command lines`;
    } else if (cwdObserved > 0) {
      cwdDetail = "Working directories available";
    } else if (cwdInferred > 0) {
      cwdDetail = `${cwdInferred} inferred from command lines`;
    }
    return {
      processDiscovery: {
        ok: processes.length > 0,
        detail: processes.length > 0 ? `${processes.length} processes` : "No processes discovered",
        limited,
      },
      socketDiscovery: {
        ok: sockets.length > 0,
        detail:
          sockets.length > 0 ? `${sockets.length} listeners` : "No listening sockets discovered",
      },
      cwdInspection: {
        ok: cwdObserved > 0 || cwdInferred > 0,
        limited: cwdObserved === 0,
        detail: cwdDetail,
      },
      wslForwarding: {
        ok: true,
        limited: forwarded === 0 && this.runtime.platform === "win32",
        detail:
          forwarded > 0
            ? `${forwarded} WSL/portproxy forwarded port${forwarded === 1 ? "" : "s"}`
            : this.runtime.platform === "win32"
              ? "No WSL or portproxy forwards detected"
              : "Not applicable",
      },
      sqlite: { ok: true, detail: "Local cache enabled" },
      docker: dockerAvail,
      httpHealth: {
        ok: this.config.health.enabled,
        detail: this.config.health.enabled ? "Conservative HTTP/TCP probes" : "Disabled",
      },
      platform: this.runtime.platform,
    };
  }

  private async safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.warn(`${label} failed`, { error: String(error) });
      return fallback;
    }
  }
}

function summarize(services: Service[], warnings: Warning[]): StatusSummary {
  const interesting = services.filter((s) => s.classification !== "system-service");
  return {
    services: interesting.length,
    healthy: interesting.filter((s) => s.health === "healthy" || s.health === "running").length,
    unhealthy: interesting.filter((s) => s.health === "unhealthy").length,
    stopped: interesting.filter((s) => s.health === "stopped").length,
    warning: warnings.length,
    unknown: interesting.filter((s) => s.health === "unknown").length,
    orphaned: interesting.filter((s) => s.health === "orphaned").length,
  };
}

function inferIssue(
  service: Service | undefined,
  processInfo: ProcessInfo | undefined,
  snapshot: Snapshot,
  sockets: ListeningSocket[],
): string | undefined {
  const forwarded = sockets.find((s) => s.forwarded)?.forwarded;
  if (forwarded) {
    return forwarded.detail;
  }
  if (service?.health === "orphaned") return service.orphanReason ?? "This process looks orphaned.";
  if (service?.health === "unhealthy") return "The process is alive but the health check failed.";
  const publicSock = snapshot.sockets.find(
    (s) => s.pid === processInfo?.pid && (s.scope === "unspecified" || s.scope === "public"),
  );
  if (publicSock) {
    return `This service is bound on ${formatEndpoint(publicSock.address, publicSock.port)} and may be reachable from other machines.`;
  }
  if (processInfo?.cwd && service?.classification === "development-server") {
    return "This appears to be a development server.";
  }
  return undefined;
}

function diffSnapshots(
  previous: Snapshot | undefined,
  next: {
    processes: ProcessInfo[];
    sockets: ListeningSocket[];
    projects: Project[];
    services: Service[];
    warnings: Warning[];
    scannedAt: string;
  },
): DomainEvent[] {
  const at = next.scannedAt;
  const events: DomainEvent[] = [];
  const prevPids = new Set(previous?.processes.map((p) => p.pid) ?? []);
  const nextPids = new Set(next.processes.map((p) => p.pid));
  for (const proc of next.processes) {
    if (!prevPids.has(proc.pid) && previous) {
      events.push({ type: "ProcessStarted", at, pid: proc.pid, executable: proc.executable });
    }
  }
  for (const proc of previous?.processes ?? []) {
    if (!nextPids.has(proc.pid)) {
      events.push({ type: "ProcessExited", at, pid: proc.pid, executable: proc.executable });
    }
  }
  const prevSocks = new Set(previous?.sockets.map((s) => s.id) ?? []);
  const nextSocks = new Set(next.sockets.map((s) => s.id));
  for (const socket of next.sockets) {
    if (!prevSocks.has(socket.id) && previous) {
      events.push({
        type: "SocketOpened",
        at,
        port: socket.port,
        address: socket.address,
        pid: socket.pid,
      });
    }
  }
  for (const socket of previous?.sockets ?? []) {
    if (!nextSocks.has(socket.id)) {
      events.push({
        type: "SocketClosed",
        at,
        port: socket.port,
        address: socket.address,
        pid: socket.pid,
      });
    }
  }
  const prevProjects = new Set(previous?.projects.map((p) => p.id) ?? []);
  for (const project of next.projects) {
    if (!prevProjects.has(project.id)) {
      events.push({
        type: "ProjectDiscovered",
        at,
        projectId: project.id,
        name: project.name,
        root: project.root,
      });
    }
  }
  const prevServices = new Map(previous?.services.map((s) => [s.id, s]) ?? []);
  for (const service of next.services) {
    const before = prevServices.get(service.id);
    const port = undefined;
    if (!before) {
      events.push({
        type: "ServiceDiscovered",
        at,
        serviceId: service.id,
        name: service.name,
        port,
      });
    } else if (before.health !== service.health) {
      events.push({
        type: "HealthChanged",
        at,
        serviceId: service.id,
        from: before.health,
        to: service.health,
      });
    }
  }
  const prevWarnings = new Set(previous?.warnings.map((w) => w.id) ?? []);
  const nextWarnings = new Set(next.warnings.map((w) => w.id));
  for (const warning of next.warnings) {
    if (!prevWarnings.has(warning.id)) {
      events.push({ type: "WarningRaised", at, warningId: warning.id, title: warning.title });
    }
  }
  for (const warning of previous?.warnings ?? []) {
    if (!nextWarnings.has(warning.id)) {
      events.push({ type: "WarningResolved", at, warningId: warning.id, title: warning.title });
    }
  }
  return events;
}

function adaptiveDelay(interval: "adaptive" | number, idleTicks: number): number {
  if (typeof interval === "number") return Math.max(1000, interval);
  if (idleTicks <= 1) return 2500;
  if (idleTicks <= 4) return 5000;
  if (idleTicks <= 10) return 15000;
  return 30000;
}

function attachContainers(
  services: Service[],
  sockets: ListeningSocket[],
  containers: import("../domain/types.js").ContainerInfo[],
): void {
  for (const container of containers) {
    for (const mapping of container.ports) {
      if (mapping.host === undefined) continue;
      const sock = sockets.find((s) => s.port === mapping.host);
      if (!sock) continue;
      const service = services.find((s) => s.socketIds.includes(sock.id));
      if (!service) continue;
      service.containerId = container.id;
      if (container.composeService) service.name = container.composeService;
      if (service.classification === "unknown") service.classification = "container";
    }
  }
}

async function detectWantedPorts(
  fs: import("../runtime/fs.js").FileSystemProvider,
  projects: Project[],
): Promise<Array<{ projectId: string; port: number; source: string }>> {
  const wanted: Array<{ projectId: string; port: number; source: string }> = [];
  for (const project of projects) {
    const pkg = await fs.readFile(fs.join(project.root, "package.json"));
    if (pkg) {
      const ports = portsFromPackageJson(pkg);
      for (const port of ports)
        wanted.push({ projectId: project.id, port, source: "package.json" });
    }
    const env = await fs.readFile(fs.join(project.root, ".env"));
    if (env) {
      const match = /^PORT\s*=\s*(\d+)/m.exec(env);
      if (match?.[1]) {
        wanted.push({
          projectId: project.id,
          port: Number.parseInt(match[1], 10),
          source: ".env PORT",
        });
      }
    }
  }
  return wanted;
}

export function portsFromPackageJson(text: string): number[] {
  const ports: number[] = [];
  try {
    const json = JSON.parse(text) as { scripts?: Record<string, string> };
    for (const script of Object.values(json.scripts ?? {})) {
      const matches = script.matchAll(/(?:--port|-p|--listen)\s+(\d{2,5})/g);
      for (const match of matches) {
        const n = Number.parseInt(match[1] ?? "", 10);
        if (n >= 1 && n <= 65535) ports.push(n);
      }
    }
  } catch {
    return [];
  }
  return [...new Set(ports)];
}

export { ancestorsOf };
