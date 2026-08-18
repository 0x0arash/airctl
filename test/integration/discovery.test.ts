import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FrozenClock } from "../../src/runtime/clock.js";
import { MemoryFileSystem } from "../../src/runtime/fs.js";
import { MapEnv } from "../../src/runtime/env.js";
import { FakeCommandRunner } from "../../src/runtime/spawn.js";
import type { Runtime } from "../../src/runtime/index.js";
import { StaticProcessProvider } from "../../src/process/provider.js";
import { StaticSocketProvider } from "../../src/network/provider.js";
import { FilesystemProjectDetector } from "../../src/projects/detect.js";
import { DiscoveryEngine } from "../../src/engine/engine.js";
import { MemorySnapshotStore } from "../../src/storage/store.js";
import { UnavailableContainerProvider } from "../../src/docker/provider.js";
import { DetectorRegistry } from "../../src/detectors/registry.js";
import type { HealthChecker } from "../../src/health/check.js";
import { socketIdFor } from "../../src/domain/ids.js";
import { defaultConfig } from "../../src/config/load.js";
import { parseDockerPsJson, parseDockerPorts } from "../../src/docker/provider.js";

function testRuntime(fs: MemoryFileSystem): Runtime {
  return {
    clock: new FrozenClock(new Date("2026-01-01T00:00:00.000Z")),
    fs,
    commands: new FakeCommandRunner(),
    env: new MapEnv(),
    platform: "linux",
    homedir: () => "/home/dev",
    tmpdir: () => "/tmp",
  };
}

describe("discovery pipeline", () => {
  it("builds a shop topology from fake OS state", async () => {
    const fs = new MemoryFileSystem();
    fs.addDir("/code/shop");
    fs.addDir("/code/shop/.git");
    fs.addFile("/code/shop/.git/HEAD", "ref: refs/heads/main");
    fs.addFile("/code/shop/package.json", '{"scripts":{"dev":"vite --port 5173"}}');
    fs.addFile("/code/shop/vite.config.ts", "");
    fs.addFile("/code/shop/docker-compose.yml", "services:\n  api:\n    ports: ['8080:8080']\n");

    const processes = [
      {
        pid: 100,
        parentPid: 10,
        executable: "node",
        command: "vite --port 5173",
        cwd: "/code/shop",
        availability: "ok" as const,
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        pid: 101,
        parentPid: 10,
        executable: "node",
        command: "node api.js --port 8080",
        cwd: "/code/shop",
        availability: "ok" as const,
      },
      {
        pid: 102,
        parentPid: 1,
        executable: "postgres",
        command: "postgres",
        cwd: "/code/shop",
        availability: "ok" as const,
      },
    ];
    const sock = (pid: number, port: number, address = "127.0.0.1") => ({
      id: socketIdFor({ family: "ipv4" as const, address, port, protocol: "tcp" as const }),
      address,
      port,
      protocol: "tcp" as const,
      pid,
      family: "ipv4" as const,
      bindAddress: address,
      scope: address === "127.0.0.1" ? ("loopback" as const) : ("unspecified" as const),
    });

    const health: HealthChecker = {
      async check(service) {
        return service.name.includes("postgres") ? "healthy" : "healthy";
      },
    };

    const engine = new DiscoveryEngine({
      runtime: testRuntime(fs),
      processes: new StaticProcessProvider(processes),
      sockets: new StaticSocketProvider([sock(100, 5173), sock(101, 8080), sock(102, 5432)]),
      projects: new FilesystemProjectDetector(fs),
      detectors: new DetectorRegistry(),
      health,
      containers: new UnavailableContainerProvider(),
      store: new MemorySnapshotStore(),
      config: defaultConfig,
    });

    const snapshot = await engine.scan();
    assert.equal(snapshot.projects[0]?.name, "shop");
    assert.ok(snapshot.services.some((s) => s.framework?.name === "Vite"));
    assert.ok(snapshot.services.some((s) => s.classification === "database"));
    const expl = await engine.explainPort(5173);
    assert.equal(expl.occupied, true);
    assert.equal(expl.process?.pid, 100);
    assert.equal(expl.project?.name, "shop");
    assert.ok(expl.actions.some((a) => a.includes("stop")));
    const gone = await engine.inspectPid(100);
    assert.equal(gone.pid, 100);
    await assert.rejects(() => engine.inspectPid(99999));
  });
});

describe("docker parser", () => {
  it("parses docker ps json lines without requiring docker", () => {
    const text = JSON.stringify({
      ID: "abc",
      Names: "shop-api-1",
      Image: "node:22",
      Status: "Up 2 hours (healthy)",
      Ports: "0.0.0.0:8080->8080/tcp",
      Labels: "com.docker.compose.project=shop,com.docker.compose.service=api",
    });
    const [container] = parseDockerPsJson(text);
    assert.equal(container?.name, "shop-api-1");
    assert.equal(container?.composeProject, "shop");
    assert.equal(parseDockerPorts("0.0.0.0:8080->8080/tcp")[0]?.host, 8080);
  });
});
