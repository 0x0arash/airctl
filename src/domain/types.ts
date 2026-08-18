export type ProcessId = number;
export type Port = number;

export type EvidenceKind = "observed" | "inferred" | "unknown";

export type Availability =
  | "ok"
  | "permission-limited"
  | "gone"
  | "unsupported"
  | "timeout"
  | "unknown";

export type AddressFamily = "ipv4" | "ipv6";
export type TransportProtocol = "tcp" | "udp";

export type BindScope = "loopback" | "private" | "public" | "unspecified";

export type ServiceClassification =
  | "development-server"
  | "database"
  | "cache"
  | "container"
  | "system-service"
  | "proxy"
  | "unknown";

export type HealthState = "running" | "healthy" | "unhealthy" | "unknown" | "stopped" | "orphaned";

export interface ProcessInfo {
  pid: ProcessId;
  parentPid?: ProcessId;
  executable?: string;
  executablePath?: string;
  command?: string;
  cwd?: string;
  user?: string;
  startedAt?: string;
  cpuPercent?: number;
  memoryBytes?: number;
  availability: Availability;
}

export interface ListeningSocket {
  id: string;
  address: string;
  port: Port;
  protocol: TransportProtocol;
  pid?: ProcessId;
  family: AddressFamily;
  bindAddress: string;
  scope: BindScope;
}

export interface Project {
  id: string;
  root: string;
  name: string;
  repository?: string;
  kind?: string;
  markers: string[];
}

export interface FrameworkGuess {
  name: string;
  confidence: number;
  evidence: string[];
}

export interface Service {
  id: string;
  projectId?: string;
  processId?: ProcessId;
  socketIds: string[];
  name: string;
  classification: ServiceClassification;
  confidence: number;
  health: HealthState;
  framework?: FrameworkGuess;
  evidenceKind: EvidenceKind;
  containerId?: string;
  orphanReason?: string;
}

export interface Warning {
  id: string;
  kind:
    | "public-bind"
    | "port-conflict"
    | "orphaned"
    | "unhealthy"
    | "unknown-process"
    | "permission";
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  related: {
    pid?: ProcessId;
    port?: Port;
    projectId?: string;
    serviceId?: string;
    socketId?: string;
  };
}

export interface TopologyNode {
  id: string;
  kind: "service" | "project" | "process";
  label: string;
  serviceId?: string;
  projectId?: string;
  processId?: ProcessId;
}

export interface TopologyEdge {
  from: string;
  to: string;
  kind: EvidenceKind;
  reason: string;
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface CapabilityReport {
  processDiscovery: CapabilityStatus;
  socketDiscovery: CapabilityStatus;
  cwdInspection: CapabilityStatus;
  sqlite: CapabilityStatus;
  docker: CapabilityStatus;
  httpHealth: CapabilityStatus;
  platform: NodeJS.Platform;
}

export interface CapabilityStatus {
  ok: boolean;
  detail: string;
  limited?: boolean;
}

export interface StatusSummary {
  services: number;
  healthy: number;
  unhealthy: number;
  stopped: number;
  warning: number;
  unknown: number;
  orphaned: number;
}

export interface ActivityEvent {
  id: string;
  at: string;
  type: string;
  message: string;
}

export interface Snapshot {
  scannedAt: string;
  durationMs: number;
  processes: ProcessInfo[];
  sockets: ListeningSocket[];
  projects: Project[];
  services: Service[];
  warnings: Warning[];
  graph: TopologyGraph;
  capabilities: CapabilityReport;
  summary: StatusSummary;
  events: ActivityEvent[];
}

export interface PortExplanation {
  port: Port;
  occupied: boolean;
  sockets: ListeningSocket[];
  process?: ProcessInfo;
  project?: Project;
  service?: Service;
  parent?: ProcessInfo;
  classification?: ServiceClassification;
  confidence?: number;
  likelyIssue?: string;
  actions: string[];
}

export interface DoctorReport {
  checks: Array<{ name: string; ok: boolean; limited?: boolean; detail: string }>;
  warnings: Warning[];
  platform: NodeJS.Platform;
  nodeVersion: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  health?: string;
  ports: Array<{ host?: Port; container: Port; protocol: TransportProtocol }>;
  composeProject?: string;
  composeService?: string;
  labels: Record<string, string>;
}
