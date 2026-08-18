export interface StatusPayload {
  version: number;
  scannedAt: string;
  durationMs: number;
  summary: {
    services: number;
    healthy: number;
    unhealthy: number;
    stopped: number;
    warning: number;
    unknown: number;
    orphaned: number;
  };
  services: Array<{
    id: string;
    name: string;
    projectId: string | null;
    processId: number | null;
    ports: number[];
    classification: string;
    confidence: number;
    health: string;
    framework: { name: string; confidence: number; evidence: string[] } | null;
    evidenceKind: string;
  }>;
  projects: Array<{ id: string; name: string; root: string; kind: string | null }>;
  warnings: Array<{
    id: string;
    kind: string;
    severity: string;
    title: string;
    detail: string;
    related: { pid?: number; port?: number; projectId?: string; serviceId?: string };
  }>;
  capabilities: Record<string, unknown>;
}

export interface GraphPayload {
  nodes: Array<{ id: string; kind: string; label: string; serviceId?: string; projectId?: string }>;
  edges: Array<{ from: string; to: string; kind: string; reason: string }>;
}

export interface SnapshotExtras {
  processes: Array<{
    pid: number;
    parentPid?: number;
    executable?: string;
    command?: string;
    cwd?: string;
    startedAt?: string;
  }>;
  sockets: Array<{
    id: string;
    address: string;
    port: number;
    pid?: number;
    scope: string;
    family: string;
  }>;
  events: Array<{ id: string; at: string; type: string; message: string }>;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

function token(): string {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  return hash.get("token") ?? "";
}

export const api = {
  status: () => getJson<StatusPayload>("/api/v1/status"),
  graph: () => getJson<GraphPayload>("/api/v1/graph"),
  processes: () => getJson<{ processes: SnapshotExtras["processes"] }>("/api/v1/processes"),
  sockets: () => getJson<{ sockets: SnapshotExtras["sockets"] }>("/api/v1/sockets"),
  events: () => getJson<{ events?: SnapshotExtras["events"] }>("/api/v1/status"),
  explain: (port: number) => getJson<Record<string, unknown>>(`/api/v1/explain/${port}`),
  inspect: (pid: number) =>
    getJson<{ process: SnapshotExtras["processes"][number] }>(`/api/v1/processes/${pid}`),
  refresh: () =>
    fetch("/api/v1/refresh", {
      method: "POST",
      headers: { "x-airctl-token": token() },
    }),
  stop: (pid: number) =>
    fetch(`/api/v1/processes/${pid}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-airctl-token": token() },
      body: JSON.stringify({}),
    }),
  subscribe(onEvent: () => void): () => void {
    const es = new EventSource("/api/v1/events");
    es.onmessage = () => onEvent();
    return () => es.close();
  },
};
