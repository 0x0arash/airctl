import type {
  ContainerInfo,
  EstablishedConnection,
  ListeningSocket,
  ProcessInfo,
  Project,
  Service,
  TopologyEdge,
  TopologyGraph,
  TopologyNode,
} from "../domain/types.js";
import { connectionTargetsListener, isLocalhostConnection } from "../network/connections.js";

export function inferTopology(input: {
  services: Service[];
  processes: ProcessInfo[];
  sockets: ListeningSocket[];
  projects: Project[];
  containers?: ContainerInfo[];
  connections?: EstablishedConnection[];
}): TopologyGraph {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const byPid = new Map(input.processes.map((p) => [p.pid, p]));

  for (const project of input.projects) {
    nodes.push({
      id: project.id,
      kind: "project",
      label: project.name,
      projectId: project.id,
    });
  }

  for (const service of input.services) {
    nodes.push({
      id: service.id,
      kind: "service",
      label: service.name,
      serviceId: service.id,
      projectId: service.projectId,
      processId: service.processId,
    });
    if (service.projectId) {
      edges.push({
        from: service.projectId,
        to: service.id,
        kind: "observed",
        reason: "service belongs to project",
      });
    }
  }

  const projectServices = new Map<string, Service[]>();
  for (const service of input.services) {
    if (!service.projectId) continue;
    const list = projectServices.get(service.projectId) ?? [];
    list.push(service);
    projectServices.set(service.projectId, list);
  }

  for (const [, group] of projectServices) {
    const frontend = group.find((s) => /vite|next|nuxt|astro|remix|frontend|web/i.test(s.name));
    const api = group.find((s) =>
      /api|express|fastify|nest|django|flask|rails|laravel|go|spring/i.test(s.name),
    );
    const db = group.find((s) => s.classification === "database");
    const cache = group.find((s) => s.classification === "cache");
    if (frontend && api) {
      edges.push({
        from: frontend.id,
        to: api.id,
        kind: "inferred",
        reason: "typical frontend → api relationship in the same project",
      });
    }
    const caller = api ?? frontend;
    if (caller && db) {
      edges.push({
        from: caller.id,
        to: db.id,
        kind: "inferred",
        reason: "typical application → database relationship in the same project",
      });
    }
    if (caller && cache) {
      edges.push({
        from: caller.id,
        to: cache.id,
        kind: "inferred",
        reason: "typical application → cache relationship in the same project",
      });
    }
  }

  for (const service of input.services) {
    if (service.processId === undefined) continue;
    const proc = byPid.get(service.processId);
    if (proc?.command) {
      for (const other of input.services) {
        if (other.id === service.id) continue;
        const ports = input.sockets
          .filter((s) => other.socketIds.includes(s.id))
          .map((s) => s.port);
        for (const port of ports) {
          if (
            commandReferencesPort(proc.command, port) &&
            other.classification !== "system-service"
          ) {
            edges.push({
              from: service.id,
              to: other.id,
              kind: "inferred",
              reason: `command line references port ${port}`,
            });
          }
        }
      }
    }
  }

  for (const connection of input.connections ?? []) {
    if (!isLocalhostConnection(connection) || connection.pid === undefined) continue;
    const sources = input.services.filter((s) => s.processId === connection.pid);
    if (sources.length === 0) continue;
    const targets = input.services.filter((service) =>
      input.sockets.some(
        (socket) =>
          service.socketIds.includes(socket.id) && connectionTargetsListener(connection, socket),
      ),
    );
    for (const source of sources) {
      for (const target of targets) {
        if (source.id === target.id) continue;
        edges.push({
          from: source.id,
          to: target.id,
          kind: "observed",
          reason: `TCP connection to localhost:${connection.remotePort}`,
        });
      }
    }
  }

  for (const container of input.containers ?? []) {
    if (!container.composeProject) continue;
    const related = input.services.filter((s) => s.containerId === container.id);
    for (let i = 0; i < related.length; i += 1) {
      for (let j = i + 1; j < related.length; j += 1) {
        const a = related[i];
        const b = related[j];
        if (!a || !b) continue;
        edges.push({
          from: a.id,
          to: b.id,
          kind: "observed",
          reason: `same Compose project ${container.composeProject}`,
        });
      }
    }
  }

  return { nodes, edges: dedupeEdges(edges) };
}

function commandReferencesPort(command: string, port: number): boolean {
  const re = new RegExp(`(?:localhost|127\\.0\\.0\\.1|::1|0\\.0\\.0\\.0):${port}\\b`);
  return re.test(command) || new RegExp(`(?:--port|-p)\\s+${port}\\b`).test(command);
}

function dedupeEdges(edges: TopologyEdge[]): TopologyEdge[] {
  const byPair = new Map<string, TopologyEdge[]>();
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    const list = byPair.get(key) ?? [];
    list.push(edge);
    byPair.set(key, list);
  }
  const out: TopologyEdge[] = [];
  for (const group of byPair.values()) {
    const observed = group.filter((e) => e.kind === "observed");
    const preferred = observed.length > 0 ? observed : group;
    const seen = new Set<string>();
    for (const edge of preferred) {
      if (seen.has(edge.reason)) continue;
      seen.add(edge.reason);
      out.push(edge);
    }
  }
  return out;
}
