import type { Snapshot, Service } from "../domain/types.js";
import { visibleServices } from "../cli/format.js";

export interface ServiceRow {
  service: Service;
  project: string;
  root?: string;
  ports: number[];
}

export function terminalText(value: string): string {
  // oxlint-disable-next-line no-control-regex -- Untrusted process names must not control the terminal.
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}

export function serviceRows(
  snapshot: Snapshot,
  options: { all: boolean; project?: string; query: string },
): ServiceRow[] {
  const needle = options.query.trim().toLowerCase();
  return visibleServices(snapshot, options.all, options.project)
    .map((service) => {
      const project = snapshot.projects.find((item) => item.id === service.projectId);
      return {
        service,
        project: project?.name ?? "No project",
        root: project?.root,
        ports: [
          ...new Set([
            ...snapshot.sockets
              .filter((socket) => service.socketIds.includes(socket.id))
              .map((socket) => socket.port),
            ...(service.publishedPorts ?? []),
          ]),
        ],
      };
    })
    .filter(
      (row) =>
        !needle ||
        `${row.project} ${row.root ?? ""} ${row.service.name} ${row.service.processId ?? ""} ${row.ports.join(" ")} ${row.service.health}`
          .toLowerCase()
          .includes(needle),
    )
    .sort(
      (a, b) =>
        a.project.localeCompare(b.project) ||
        (a.ports[0] ?? 0) - (b.ports[0] ?? 0) ||
        a.service.name.localeCompare(b.service.name),
    );
}

export function sameProcess(
  before: { pid: number; startedAt?: string; executable?: string; command?: string; cwd?: string },
  after: typeof before,
): boolean {
  return (
    before.pid === after.pid &&
    before.executable === after.executable &&
    before.command === after.command &&
    before.cwd === after.cwd &&
    (!before.startedAt || before.startedAt === after.startedAt)
  );
}
