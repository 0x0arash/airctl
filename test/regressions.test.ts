import { stopCommand } from "../src/cli.js";
import { parseArgv } from "../src/cli/parse.js";
import type { AppContext } from "../src/engine/app.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServer } from "node:http";
import { testEngine, socket } from "./helpers/engine.js";
import { loadBundled } from "./helpers/bundle.js";
import { MemorySnapshotStore } from "../src/storage/store.js";
import { StaticProcessProvider } from "../src/process/provider.js";
import { StaticSocketProvider } from "../src/network/provider.js";
import { MemoryFileSystem } from "../src/runtime/fs.js";
import { FilesystemProjectDetector } from "../src/projects/detect.js";
import { projectIdFor } from "../src/domain/ids.js";
import { parseConfigText, mergeConfig, defaultConfig, formatConfig } from "../src/config/load.js";
import { ConservativeHealthChecker, defaultHealthOptions } from "../src/health/check.js";
import { parseDockerPorts } from "../src/docker/provider.js";
import { snapshotToJson } from "../src/cli/format.js";
import { type ContainerInfo, type Service } from "../src/domain/types.js";
import { listWindowsProcesses } from "../src/process/windows.js";
import { queryWindowsProcessCwds, buildWindowsCwdScript } from "../src/process/windows-cwd.js";
import { NodeCommandRunner } from "../src/runtime/spawn.js";

const health = { check: async () => "healthy" as const };
const proc = (pid: number, cwd?: string) => ({
  pid,
  executable: "unknown",
  command: "unknown",
  cwd,
  availability: "ok" as const,
});
const container = (id: string, ports: ContainerInfo["ports"]): ContainerInfo => ({
  id,
  name: id,
  image: "test",
  status: "Up 2 minutes",
  labels: {},
  ports,
  composeProject: "shop",
});

describe("scan lifecycle", () => {
  it("shares initial and subsequent in-flight scans", async () => {
    let calls = 0;
    let release!: () => void;
    let gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = testEngine({
      processes: {
        listProcesses: async () => {
          calls++;
          await gate;
          return [];
        },
        inspect: async () => undefined,
      },
    });
    const first = engine.scan();
    const second = engine.scan();
    assert.equal(first, second);
    release();
    await first;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const third = engine.refresh();
    const fourth = engine.scan();
    assert.equal(third, fourth);
    release();
    await third;
    assert.equal(calls, 2);
    await engine.close();
  });

  it("uses persisted snapshots as the event baseline and reports memory storage honestly", async () => {
    const store = new MemorySnapshotStore();
    const deps = {
      store,
      health,
      processes: new StaticProcessProvider([proc(101)]),
      sockets: new StaticSocketProvider([socket(101, 8765)]),
    };
    const first = testEngine(deps);
    const snapshot = await first.scan();
    const second = testEngine(deps);
    const next = await second.scan();
    assert.equal(next.events.length, snapshot.events.length);
    assert.equal(next.capabilities.sqlite.ok, false);
    await first.close();
    await second.close();
  });
});

describe("identity and evidence", () => {
  it("keeps case-sensitive projects separate through discovery", async () => {
    const fs = new MemoryFileSystem();
    fs.addFile("/code/Shop/package.json", "{}");
    fs.addFile("/code/shop/package.json", "{}");
    const projects = await new FilesystemProjectDetector(fs).detectFromProcesses([
      proc(1, "/code/Shop"),
      proc(2, "/code/shop"),
    ]);
    assert.equal(projects.length, 2);
    assert.notEqual(projectIdFor("/code/Shop"), projectIdFor("/code/shop"));
    assert.equal(projectIdFor("C:\\Code\\Shop"), projectIdFor("c:\\code\\shop"));
  });

  it("labels a port-only database guess as inferred", async () => {
    const engine = testEngine({
      processes: new StaticProcessProvider([proc(101)]),
      sockets: new StaticSocketProvider([socket(101, 5432)]),
      health,
    });
    const snapshot = await engine.scan();
    assert.equal(snapshot.services[0]!.name, "Postgres");
    assert.equal(snapshot.services[0]!.evidenceKind, "inferred");
    await engine.close();
  });
});

describe("Docker correlation", () => {
  it("preserves host addresses and protocols", () => {
    assert.deepEqual(parseDockerPorts("127.0.0.1:8080->80/tcp, [::]:8080->80/udp"), [
      { hostAddress: "127.0.0.1", host: 8080, container: 80, protocol: "tcp" },
      { hostAddress: "::", host: 8080, container: 80, protocol: "udp" },
    ]);
  });
  it("matches all exact endpoints and retains NAT-only containers", async () => {
    const containers = [
      container("tcp", [{ hostAddress: "127.0.0.1", host: 8765, container: 80, protocol: "tcp" }]),
      container("nat", [{ hostAddress: "0.0.0.0", host: 8766, container: 80, protocol: "tcp" }]),
    ];
    const engine = testEngine({
      health,
      processes: new StaticProcessProvider([proc(101), proc(102)]),
      sockets: new StaticSocketProvider([socket(101, 8765), socket(102, 8765, "127.0.0.1", "udp")]),
      containers: {
        available: async () => ({ ok: true, detail: "test" }),
        listContainers: async () => containers,
      },
    });
    const snapshot = await engine.scan();
    assert.equal(snapshot.services.find((s) => s.processId === 101)!.containerId, "tcp");
    assert.equal(snapshot.services.find((s) => s.processId === 102)!.containerId, undefined);
    assert.deepEqual(
      snapshot.services.find((s) => s.containerId === "nat")!.publishedPorts,
      [8766],
    );
    const edges = snapshot.graph.edges.filter((e) => e.reason.includes("Compose"));
    assert.equal(edges.length, 1);
    assert.equal(edges[0]!.kind, "inferred");
    await engine.close();
  });
});

describe("health timeouts", () => {
  it("does not report a hung HTTP server as healthy", async () => {
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const checker = new ConservativeHealthChecker({ ...defaultHealthOptions, httpTimeoutMs: 50 });
      assert.equal(
        await checker.check({ classification: "development-server" } as Service, [socket(1, port)]),
        "unhealthy",
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("configuration validation", () => {
  it("rejects malformed JSON and invalid values with INVALID_INPUT", () => {
    for (const value of [
      "{",
      "[]",
      '{"projects":{"roots":"~/code"}}',
      '{"ui":{"port":70000}}',
      '{"scan":{"interval":0}}',
      '{"events":{"limit":-1}}',
      '{"health":{"enabled":"false"}}',
      '{"security":{"bind":"0.0.0.0"}}',
      '{"unknown":{}}',
      '{"security":{"bind":["localhost"]}}',
      '{"constructor":{}}',
      '{"ui":{"toString":123}}',
    ]) {
      assert.throws(() => parseConfigText(value, "config.json"), { code: "INVALID_INPUT" });
    }
  });
  it("round-trips effective config and preserves hashes inside quoted paths", () => {
    const config = mergeConfig(
      defaultConfig,
      parseConfigText(
        'projects:\n  roots:\n    - "/code/my#project"\nui:\n  bind: localhost',
        "config.yaml",
      ),
      "/home/dev",
    );
    assert.deepEqual(config.projects.roots, ["/code/my#project"]);
    assert.equal(config.security.bind, "localhost");
    assert.deepEqual(
      mergeConfig(defaultConfig, parseConfigText(formatConfig(config), "config.yaml"), "/home/dev"),
      config,
    );
    assert.deepEqual(
      mergeConfig(
        defaultConfig,
        parseConfigText(formatConfig(defaultConfig), "config.yaml"),
        "/home/dev",
      ),
      defaultConfig,
    );
  });
});

describe("extension result handling", () => {
  it("parses a free-port explanation and a stop timeout instead of discarding JSON", async () => {
    const extension = loadBundled("vscode-extension/src/airctl.ts", {
      vscode: { workspace: { getConfiguration: () => ({ get: () => "" }) } },
      "node:fs": { existsSync: () => false },
      "node:child_process": {
        execFile: (_cmd: string, args: string[], _opts: unknown, cb: Function) => {
          const explain = args.includes("explain");
          cb(
            Object.assign(new Error("nonzero"), { code: explain ? 3 : 7 }),
            JSON.stringify(
              explain
                ? { occupied: false, port: 65000 }
                : { stopped: [{ pid: 123, stopped: false }] },
            ),
            "",
          );
        },
      },
    });
    assert.equal((await extension.explainPort!(65000)).occupied, false);
    assert.equal((await extension.stopProcess!(123)).stopped[0].stopped, false);
  });
});

describe("Windows native collectors", () => {
  it(
    "returns actual process details and observed CWD",
    { skip: process.platform !== "win32" },
    async () => {
      const commands = new NodeCommandRunner();
      const processes = await listWindowsProcesses(commands);
      const self = processes.find((p) => p.pid === process.pid);
      assert.ok(self?.command?.includes("node"));
      assert.ok(self?.executable);
      const cwd = await queryWindowsProcessCwds(commands, [process.pid]);
      assert.equal(cwd.get(process.pid)?.toLowerCase(), process.cwd().toLowerCase());
    },
  );
  it("never assigns the automatic PowerShell PID variable", () => {
    assert.doesNotMatch(buildWindowsCwdScript([123]), /foreach \(\$pid\b/i);
  });
});

describe("filtered response consistency", () => {
  it("recomputes summaries and filters projects and warnings", async () => {
    const engine = testEngine();
    const snapshot = await engine.scan();
    snapshot.projects = [
      { id: "a", root: "/code/a", name: "a", markers: [] },
      { id: "b", root: "/code/b", name: "b", markers: [] },
    ];
    snapshot.services = [
      {
        id: "one",
        name: "one",
        projectId: "a",
        socketIds: [],
        health: "healthy",
        classification: "development-server",
        confidence: 1,
        evidenceKind: "inferred",
      },
      {
        id: "two",
        name: "two",
        projectId: "b",
        socketIds: [],
        health: "unhealthy",
        classification: "development-server",
        confidence: 1,
        evidenceKind: "inferred",
      },
      {
        id: "sys",
        name: "system",
        socketIds: [],
        health: "running",
        classification: "system-service",
        confidence: 1,
        evidenceKind: "observed",
      },
    ];
    snapshot.warnings = [
      {
        id: "warn",
        kind: "unhealthy",
        severity: "error",
        title: "test",
        detail: "test",
        related: { serviceId: "two", projectId: "b" },
      },
    ];
    const filtered = snapshotToJson(snapshot, false, "a") as any;
    assert.equal(filtered.summary.services, 1);
    assert.equal(filtered.summary.healthy, 1);
    assert.equal(filtered.summary.unhealthy, 0);
    assert.equal(filtered.summary.warning, 0);
    assert.deepEqual(
      filtered.projects.map((p: any) => p.id),
      ["a"],
    );
    const all = snapshotToJson(snapshot, true) as any;
    assert.equal(all.summary.services, all.services.length);
    await engine.close();
  });
});

describe("stop result reporting", () => {
  it("returns timeout without claiming that an alive process stopped", async () => {
    const engine = testEngine({
      health,
      processes: new StaticProcessProvider([proc(123)]),
      sockets: new StaticSocketProvider([socket(123, 8765)]),
    });
    const app = {
      engine,
      controller: { stop: async () => ({ stopped: false, signal: "SIGTERM" }) },
    } as unknown as AppContext;
    let output = "";
    const io = {
      stdout: {
        isTTY: false,
        write: (text: string) => {
          output += text;
        },
      },
      stderr: { write() {} },
    } as unknown as { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream };
    assert.equal(await stopCommand(app, ["123"], parseArgv(["stop", "123", "--yes"]).flags, io), 7);
    assert.match(output, /still running/);
    assert.doesNotMatch(output, /Stopped PID/);
    output = "";
    assert.equal(
      await stopCommand(app, ["123"], parseArgv(["stop", "123", "--yes", "--json"]).flags, io),
      7,
    );
    assert.equal(JSON.parse(output).stopped[0].stopped, false);
    await engine.close();
  });
});

describe("input and persistence boundaries", () => {
  it("rejects invalid library ports as INVALID_INPUT before discovery", async () => {
    const engine = testEngine();
    await assert.rejects(() => engine.explainPort("bogus"), { code: "INVALID_INPUT" });
    await assert.rejects(() => engine.explainPort(70000), { code: "INVALID_INPUT" });
    await engine.close();
  });
  it("restores the event baseline from SQLite across application instances", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createStore } = await import("../src/storage/store.js");
    const dir = await mkdtemp(join(tmpdir(), "airctl-history-"));
    try {
      const store = await createStore(join(dir, "cache.sqlite"));
      assert.equal(store.persistent, true);
      const deps = {
        health,
        processes: new StaticProcessProvider([proc(101)]),
        sockets: new StaticSocketProvider([socket(101, 8765)]),
      };
      const first = testEngine({ ...deps, store });
      const before = await first.scan();
      await first.close();
      const second = testEngine({ ...deps, store: await createStore(join(dir, "cache.sqlite")) });
      try {
        assert.deepEqual((await second.scan()).events, before.events);
      } finally {
        await second.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
