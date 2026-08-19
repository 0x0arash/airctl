import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveStopTargets } from "../src/control/targets.js";
import { completionScript } from "../src/cli/complete.js";
import { parseArgv, helpText } from "../src/cli/parse.js";
import type { Snapshot } from "../src/domain/types.js";
import { AirCtlError } from "../src/domain/errors.js";

function snapshot(): Snapshot {
  return {
    scannedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 1,
    processes: [
      { pid: 100, executable: "node", availability: "ok" },
      { pid: 101, executable: "node", availability: "ok" },
    ],
    sockets: [
      {
        id: "s1",
        address: "127.0.0.1",
        port: 3000,
        protocol: "tcp",
        pid: 100,
        family: "ipv4",
        bindAddress: "127.0.0.1",
        scope: "loopback",
      },
      {
        id: "s2",
        address: "127.0.0.1",
        port: 8080,
        protocol: "tcp",
        pid: 101,
        family: "ipv4",
        bindAddress: "127.0.0.1",
        scope: "loopback",
      },
    ],
    projects: [{ id: "proj_shop", root: "/code/shop", name: "shop", markers: [] }],
    services: [
      {
        id: "fe",
        name: "Vite",
        projectId: "proj_shop",
        processId: 100,
        socketIds: ["s1"],
        classification: "development-server",
        confidence: 0.9,
        health: "healthy",
        evidenceKind: "observed",
      },
      {
        id: "api",
        name: "api",
        projectId: "proj_shop",
        processId: 101,
        socketIds: ["s2"],
        classification: "development-server",
        confidence: 0.8,
        health: "healthy",
        evidenceKind: "inferred",
      },
    ],
    warnings: [],
    graph: { nodes: [], edges: [] },
    capabilities: {
      processDiscovery: { ok: true, detail: "ok" },
      socketDiscovery: { ok: true, detail: "ok" },
      cwdInspection: { ok: true, detail: "ok" },
      wslForwarding: { ok: true, detail: "n/a" },
      sqlite: { ok: true, detail: "ok" },
      docker: { ok: false, detail: "n/a" },
      httpHealth: { ok: true, detail: "ok" },
      platform: "linux",
    },
    summary: {
      services: 2,
      healthy: 2,
      unhealthy: 0,
      stopped: 0,
      warning: 0,
      unknown: 0,
      orphaned: 0,
    },
    events: [],
  };
}

describe("stop targets", () => {
  it("resolves :port and project names", () => {
    const snap = snapshot();
    assert.deepEqual(
      resolveStopTargets(snap, ":3000").map((t) => t.pid),
      [100],
    );
    const project = resolveStopTargets(snap, "shop")
      .map((t) => t.pid)
      .toSorted((a, b) => a - b);
    assert.deepEqual(project, [100, 101]);
    assert.equal(resolveStopTargets(snap, "100")[0]?.pid, 100);
  });

  it("hints at :port when a bare number is a listener but not a pid", () => {
    const snap = snapshot();
    assert.throws(() => resolveStopTargets(snap, "3000"), AirCtlError);
  });
});

describe("shell completions", () => {
  it("emits bash, zsh, fish, and powershell scripts", () => {
    assert.match(completionScript("bash"), /complete -F _airctl airctl/);
    assert.match(completionScript("zsh"), /#compdef airctl/);
    assert.match(completionScript("fish"), /complete -c airctl/);
    assert.match(completionScript("powershell"), /Register-ArgumentCompleter/);
  });

  it("documents complete and stop by port in help", () => {
    const help = helpText();
    assert.match(help, /complete/);
    assert.match(help, /:port/);
    assert.equal(parseArgv(["complete", "zsh"]).args[0], "zsh");
  });
});
