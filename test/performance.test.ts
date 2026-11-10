import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testEngine, socket } from "./helpers/engine.js";
import { MemoryFileSystem } from "../src/runtime/fs.js";
import { FilesystemProjectDetector } from "../src/projects/detect.js";
import { DockerCliProvider } from "../src/docker/provider.js";
import { serviceRows, sameProcess, terminalText } from "../src/tui/model.js";
import { StaticProcessProvider } from "../src/process/provider.js";
import { StaticSocketProvider } from "../src/network/provider.js";

const processInfo = {
  pid: 101,
  executable: "node",
  command: "node api.js",
  availability: "ok" as const,
};

describe("focused discovery", () => {
  it("answers free-port queries without processes, projects, Docker, or health probes", async () => {
    let requestedPort: number | undefined;
    const engine = testEngine({
      processes: {
        listProcesses: async () => {
          throw new Error("Full process listing must not run");
        },
        inspect: async () => {
          throw new Error("No owner to inspect");
        },
      },
      projects: {
        detectFromProcesses: async () => {
          throw new Error("No project to inspect");
        },
        inspectRoot: async () => undefined,
      },
      sockets: {
        discover: async (_processes, options) => {
          requestedPort = options?.port;
          return { listening: [], connections: [] };
        },
        listListeningSockets: async () => [],
      },
      containers: {
        available: async () => {
          throw new Error("Docker must not run");
        },
        listContainers: async () => [],
      },
    });
    assert.equal((await engine.explainPort(3000)).occupied, false);
    assert.equal(requestedPort, 3000);
    await engine.close();
  });

  it("inspects only the requested port owners", async () => {
    const inspected: number[] = [];
    const engine = testEngine({
      processes: {
        listProcesses: async () => {
          throw new Error("Unrelated processes must not run");
        },
        inspect: async (pid) => {
          inspected.push(pid);
          return { ...processInfo, pid };
        },
      },
      sockets: new StaticSocketProvider([socket(101, 3000), socket(202, 4000)]),
    });
    const result = await engine.explainPort(3000);
    assert.equal(result.process?.pid, 101);
    assert.deepEqual(inspected, [101]);
    await engine.close();
  });

  it("fast scans skip optional collectors and do not claim checked health", async () => {
    let docker = 0;
    let health = 0;
    const engine = testEngine({
      processes: new StaticProcessProvider([processInfo]),
      sockets: new StaticSocketProvider([socket(101, 3000)]),
      containers: {
        available: async () => {
          docker++;
          return { ok: false, detail: "test" };
        },
        listContainers: async () => [],
      },
      health: {
        check: async () => {
          health++;
          return "healthy";
        },
      },
    });
    const fast = await engine.scan({ fast: true });
    assert.equal(docker, 0);
    assert.equal(health, 0);
    assert.equal(fast.summary.healthy, 0);
    assert.equal(fast.summary.running, 1);
    assert.equal(fast.capabilities.httpHealth.ok, false);
    const full = await engine.scan();
    assert.equal(docker, 1);
    assert.equal(health, 1);
    assert.equal(full.summary.healthy, 1);
    await engine.close();
  });
});

describe("project filesystem budget", () => {
  it("reads shared ancestor directories once per scan and invalidates on the next scan", async () => {
    const fs = new MemoryFileSystem();
    fs.addDir("/code/shop/src/api");
    fs.addFile("/code/shop/package.json", "{}");
    fs.addFile("/code/shop/vite.config.ts", "");
    const counts = new Map<string, number>();
    const original = fs.readDir.bind(fs);
    fs.readDir = async (path) => {
      counts.set(path, (counts.get(path) ?? 0) + 1);
      return original(path);
    };
    const detector = new FilesystemProjectDetector(fs);
    const processes = Array.from({ length: 100 }, (_, index) => ({
      ...processInfo,
      pid: index + 10,
      cwd: `/code/shop/src/api/${index}`,
    }));
    const projects = await detector.detectFromProcesses(processes);
    assert.equal(projects[0]?.name, "shop");
    assert.ok(projects[0]?.markers.includes("framework:Vite"));
    assert.equal(counts.get("/code/shop"), 1);
    assert.equal(counts.get("/code/shop/src/api"), 1);
    await detector.detectFromProcesses(processes);
    assert.equal(counts.get("/code/shop"), 2);
  });
});

describe("Docker command budget", () => {
  it("uses one bounded listing for capability and container discovery", async () => {
    let calls = 0;
    const provider = new DockerCliProvider({
      run: async (_file, args, options) => {
        calls++;
        assert.deepEqual(args, ["ps", "--format", "{{json .}}"]);
        assert.equal(options?.timeoutMs, 1000);
        return {
          code: 0,
          timedOut: false,
          stderr: "",
          stdout: JSON.stringify({ ID: "abc", Names: "api", Status: "Up 1 minute" }),
        };
      },
    });
    assert.equal((await provider.available()).ok, true);
    assert.equal((await provider.listContainers())[0]?.id, "abc");
    assert.equal(calls, 1);
    assert.equal((await provider.listContainers())[0]?.id, "abc");
    assert.equal(calls, 2);
  });
});

describe("terminal interaction model", () => {
  it("finds services by PID, port and project and checks process identity before stop", async () => {
    const engine = testEngine({
      processes: new StaticProcessProvider([processInfo]),
      sockets: new StaticSocketProvider([socket(101, 3000)]),
    });
    const snapshot = await engine.scan({ fast: true });
    snapshot.projects.push({ id: "shop", name: "shop", root: "/code/shop", markers: [] });
    snapshot.services[0]!.projectId = "shop";
    for (const query of ["101", "3000", "shop", "/code/shop"])
      assert.equal(serviceRows(snapshot, { all: false, query }).length, 1);
    assert.equal(serviceRows(snapshot, { all: false, query: "missing" }).length, 0);
    assert.equal(sameProcess(processInfo, { ...processInfo, command: "another process" }), false);
    assert.equal(sameProcess(processInfo, { ...processInfo }), true);
    assert.equal(terminalText("hello\u001b[2J\nworld"), "hello world");
    await engine.close();
  });
});
