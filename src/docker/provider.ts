import type { CommandRunner } from "../runtime/spawn.js";
import type { ContainerInfo } from "../domain/types.js";

export interface ContainerProvider {
  listContainers(): Promise<ContainerInfo[]>;
  available(): Promise<{ ok: boolean; detail: string }>;
}

export class DockerCliProvider implements ContainerProvider {
  constructor(private readonly commands: CommandRunner) {}

  private listed: ContainerInfo[] | undefined;

  async available(): Promise<{ ok: boolean; detail: string }> {
    const result = await this.commands.run("docker", ["ps", "--format", "{{json .}}"], {
      timeoutMs: 1000,
    });
    this.listed = [];
    if (result.timedOut || result.code !== 0)
      return {
        ok: false,
        detail: result.timedOut
          ? "Docker discovery timed out (1s budget)"
          : "Docker integration unavailable",
      };
    this.listed = parseDockerPsJson(result.stdout);
    return { ok: true, detail: `Docker: ${this.listed.length} running containers` };
  }

  async listContainers(): Promise<ContainerInfo[]> {
    if (this.listed === undefined) await this.available();
    const listed = this.listed ?? [];
    this.listed = undefined;
    return listed;
  }
}

export class UnavailableContainerProvider implements ContainerProvider {
  async available(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: "Docker integration unavailable" };
  }

  async listContainers(): Promise<ContainerInfo[]> {
    return [];
  }
}

export function parseDockerPsJson(text: string): ContainerInfo[] {
  const containers: ContainerInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, string>;
      const labels = parseLabels(row.Labels ?? "");
      containers.push({
        id: row.ID ?? row.Id ?? "",
        name: (row.Names ?? "").replace(/^\//, ""),
        image: row.Image ?? "",
        status: row.Status ?? row.State ?? "",
        health: extractHealth(row.Status ?? ""),
        ports: parseDockerPorts(row.Ports ?? ""),
        composeProject: labels["com.docker.compose.project"],
        composeService: labels["com.docker.compose.service"],
        labels,
      });
    } catch {
      continue;
    }
  }
  return containers.filter((c) => c.id);
}

export function parseDockerPorts(raw: string): ContainerInfo["ports"] {
  const out: ContainerInfo["ports"] = [];
  if (!raw.trim()) return out;
  for (const part of raw.split(",")) {
    const piece = part.trim();
    const match = /^(?:(.*):)?(\d+)->(\d+)\/(tcp|udp)$/i.exec(piece);
    if (match) {
      out.push({
        host: Number.parseInt(match[2] ?? "", 10),
        hostAddress: match[1]?.replace(/^\[|\]$/g, ""),
        container: Number.parseInt(match[3] ?? "", 10),
        protocol: (match[4] ?? "tcp").toLowerCase() === "udp" ? "udp" : "tcp",
      });
      continue;
    }
    const exposed = /(\d+)\/(tcp|udp)/i.exec(piece);
    if (exposed) {
      out.push({
        container: Number.parseInt(exposed[1] ?? "", 10),
        protocol: (exposed[2] ?? "tcp").toLowerCase() === "udp" ? "udp" : "tcp",
      });
    }
  }
  return out;
}

function parseLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!raw) return labels;
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    labels[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return labels;
}

function extractHealth(status: string): string | undefined {
  const match = /\((\w+)\)/.exec(status);
  return match?.[1]?.toLowerCase();
}
