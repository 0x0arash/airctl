import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickProbeSocket, shouldHttpProbe } from "../src/health/check.js";
import { parseSimpleYaml, mergeConfig, defaultConfig } from "../src/config/load.js";
import { redactCommand } from "../src/domain/redact.js";
import { portsFromPackageJson } from "../src/engine/engine.js";
import { snapshotToJson } from "../src/cli/format.js";
import { parseArgv } from "../src/cli/parse.js";
import type { ListeningSocket, Snapshot } from "../src/domain/types.js";

describe("health helpers", () => {
  it("prefers loopback for probes", () => {
    const sockets: ListeningSocket[] = [
      {
        id: "a",
        address: "0.0.0.0",
        port: 3000,
        protocol: "tcp",
        family: "ipv4",
        bindAddress: "0.0.0.0",
        scope: "unspecified",
      },
      {
        id: "b",
        address: "127.0.0.1",
        port: 3000,
        protocol: "tcp",
        family: "ipv4",
        bindAddress: "127.0.0.1",
        scope: "loopback",
      },
    ];
    assert.equal(pickProbeSocket(sockets)?.id, "b");
    assert.equal(shouldHttpProbe({ classification: "development-server" } as never), true);
    assert.equal(shouldHttpProbe({ classification: "database" } as never), false);
  });
});

describe("configuration", () => {
  it("parses the documented yaml subset", () => {
    const parsed = parseSimpleYaml(`
scan:
  interval: adaptive
health:
  enabled: true
projects:
  roots:
    - ~/code
ui:
  openBrowser: true
security:
  bind: 127.0.0.1
`);
    const config = mergeConfig(defaultConfig, parsed, "/home/dev");
    assert.equal(config.health.enabled, true);
    assert.ok(config.projects.roots[0]?.endsWith("code"));
    assert.equal(config.security.bind, "127.0.0.1");
  });
});

describe("redaction and serialization", () => {
  it("redacts secrets in command lines", () => {
    assert.match(redactCommand("node app.js --password hunter2") ?? "", /\*\*\*/);
    assert.match(redactCommand("DATABASE_URL=postgres://u:p@localhost/db node") ?? "", /\*\*\*/);
    assert.equal(redactCommand("npm run dev"), "npm run dev");
  });

  it("extracts ports from package.json scripts", () => {
    assert.deepEqual(
      portsFromPackageJson(`{"scripts":{"dev":"vite --port 5173","start":"next -p 3000"}}`),
      [5173, 3000],
    );
  });

  it("emits stable json without mixing logs", () => {
    const snapshot = {
      scannedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 12,
      processes: [],
      sockets: [],
      projects: [],
      services: [],
      warnings: [],
      graph: { nodes: [], edges: [] },
      capabilities: {
        processDiscovery: { ok: true, detail: "ok" },
        socketDiscovery: { ok: true, detail: "ok" },
        cwdInspection: { ok: true, detail: "ok" },
        sqlite: { ok: true, detail: "ok" },
        docker: { ok: false, detail: "unavailable" },
        httpHealth: { ok: true, detail: "ok" },
        platform: "linux",
      },
      summary: {
        services: 0,
        healthy: 0,
        unhealthy: 0,
        stopped: 0,
        warning: 0,
        unknown: 0,
        orphaned: 0,
      },
      events: [],
    } satisfies Snapshot;
    const json = snapshotToJson(snapshot, true);
    assert.equal((json as { version: number }).version, 1);
    assert.ok(JSON.stringify(json).includes("scannedAt"));
  });
});

describe("cli parser", () => {
  it("defaults to status", () => {
    assert.equal(parseArgv([]).command, "status");
    assert.equal(parseArgv(["explain", ":3000"]).args[0], ":3000");
    assert.equal(parseArgv(["status", "--json"]).flags.json, true);
    assert.throws(() => parseArgv(["--nope"]));
  });
});
