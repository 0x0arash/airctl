import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferTopology } from "../src/topology/infer.js";
import { detectOrphans } from "../src/orphans/detect.js";
import { collectWarnings } from "../src/warnings/detect.js";
import type { ListeningSocket, ProcessInfo, Project, Service } from "../src/domain/types.js";

const shop: Project = {
  id: "proj_shop",
  root: "/code/shop",
  name: "shop",
  markers: ["package.json"],
};

function svc(partial: Partial<Service> & Pick<Service, "id" | "name">): Service {
  return {
    socketIds: [],
    classification: "unknown",
    confidence: 0.5,
    health: "running",
    evidenceKind: "inferred",
    ...partial,
  };
}

describe("topology inference", () => {
  it("infers frontend → api → db inside a project and labels evidence", () => {
    const services = [
      svc({ id: "fe", name: "Vite", projectId: shop.id, classification: "development-server" }),
      svc({ id: "api", name: "Express", projectId: shop.id, classification: "development-server" }),
      svc({ id: "db", name: "Postgres", projectId: shop.id, classification: "database" }),
    ];
    const graph = inferTopology({ services, processes: [], sockets: [], projects: [shop] });
    const inferred = graph.edges.filter((e) => e.kind === "inferred");
    assert.ok(inferred.some((e) => e.from === "fe" && e.to === "api"));
    assert.ok(inferred.some((e) => e.from === "api" && e.to === "db"));
    assert.ok(graph.edges.some((e) => e.kind === "observed" && e.from === shop.id));
  });

  it("promotes localhost TCP connections to observed edges", () => {
    const services = [
      svc({
        id: "fe",
        name: "Vite",
        processId: 10,
        socketIds: ["s5173"],
        classification: "development-server",
      }),
      svc({
        id: "api",
        name: "api",
        processId: 11,
        socketIds: ["s8080"],
        classification: "development-server",
      }),
    ];
    const sockets: ListeningSocket[] = [
      {
        id: "s5173",
        address: "127.0.0.1",
        port: 5173,
        protocol: "tcp",
        pid: 10,
        family: "ipv4",
        bindAddress: "127.0.0.1",
        scope: "loopback",
      },
      {
        id: "s8080",
        address: "127.0.0.1",
        port: 8080,
        protocol: "tcp",
        pid: 11,
        family: "ipv4",
        bindAddress: "127.0.0.1",
        scope: "loopback",
      },
    ];
    const graph = inferTopology({
      services,
      processes: [
        { pid: 10, availability: "ok" },
        { pid: 11, availability: "ok" },
      ],
      sockets,
      projects: [],
      connections: [
        {
          localAddress: "127.0.0.1",
          localPort: 54321,
          remoteAddress: "127.0.0.1",
          remotePort: 8080,
          protocol: "tcp",
          pid: 10,
          family: "ipv4",
        },
      ],
    });
    const edge = graph.edges.find((e) => e.from === "fe" && e.to === "api");
    assert.equal(edge?.kind, "observed");
    assert.match(edge?.reason ?? "", /localhost:8080/);
  });
});

describe("orphan detection", () => {
  it("does not flag a long-running process with a living parent", () => {
    const processes: ProcessInfo[] = [
      { pid: 10, executable: "zsh", availability: "ok" },
      {
        pid: 20,
        parentPid: 10,
        executable: "node",
        command: "vite",
        cwd: "/code/shop",
        availability: "ok",
      },
    ];
    const services = [
      svc({ id: "s", name: "Vite", processId: 20, classification: "development-server" }),
    ];
    const findings = detectOrphans({
      services,
      processes,
      platform: "linux",
      cwdExists: () => true,
    });
    assert.equal(findings.length, 0);
  });

  it("flags a dev server whose cwd is gone", () => {
    const processes: ProcessInfo[] = [
      {
        pid: 20,
        parentPid: 1,
        executable: "node",
        command: "vite",
        cwd: "/missing",
        availability: "ok",
      },
    ];
    const services = [
      svc({ id: "s", name: "Vite", processId: 20, classification: "development-server" }),
    ];
    const findings = detectOrphans({
      services,
      processes,
      platform: "linux",
      cwdExists: () => false,
    });
    assert.equal(findings.length, 1);
    assert.match(findings[0]?.reason ?? "", /working directory/);
  });
});

describe("warnings", () => {
  it("warns on unspecified public binds", () => {
    const sockets: ListeningSocket[] = [
      {
        id: "s1",
        address: "0.0.0.0",
        port: 8080,
        protocol: "tcp",
        pid: 9,
        family: "ipv4",
        bindAddress: "0.0.0.0",
        scope: "unspecified",
      },
    ];
    const warnings = collectWarnings({
      services: [
        svc({
          id: "api",
          name: "api",
          processId: 9,
          socketIds: ["s1"],
          classification: "development-server",
        }),
      ],
      sockets,
      processes: [{ pid: 9, availability: "ok" }],
      projects: [],
      orphans: [],
    });
    assert.ok(warnings.some((w) => w.kind === "public-bind"));
  });

  it("detects port conflicts across projects", () => {
    const sockets: ListeningSocket[] = [
      {
        id: "s1",
        address: "127.0.0.1",
        port: 3000,
        protocol: "tcp",
        pid: 9,
        family: "ipv4",
        bindAddress: "127.0.0.1",
        scope: "loopback",
      },
    ];
    const warnings = collectWarnings({
      services: [
        svc({ id: "old", name: "next", processId: 9, projectId: "old", socketIds: ["s1"] }),
      ],
      sockets,
      processes: [{ pid: 9, cwd: "/old", availability: "ok" }],
      projects: [shop, { id: "old", root: "/old", name: "old", markers: [] }],
      orphans: [],
      wantedPorts: [{ projectId: shop.id, port: 3000, source: "package.json" }],
    });
    assert.ok(warnings.some((w) => w.kind === "port-conflict"));
  });
});
