import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemorySnapshotStore } from "../src/storage/store.js";
import type { Snapshot } from "../src/domain/types.js";

describe("storage", () => {
  it("round-trips a snapshot and bounds events", async () => {
    const store = new MemorySnapshotStore();
    const snapshot = {
      scannedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 1,
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
        wslForwarding: { ok: true, detail: "n/a" },
        sqlite: { ok: true, detail: "ok" },
        docker: { ok: false, detail: "n/a" },
        httpHealth: { ok: true, detail: "ok" },
        platform: "linux" as const,
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
    await store.save(snapshot);
    const loaded = await store.load();
    assert.equal(loaded?.scannedAt, snapshot.scannedAt);
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      at: `2026-01-01T00:00:0${i}.000Z`,
      type: "x",
      message: `m${i}`,
    }));
    const kept = await store.appendEvents(events, 3);
    assert.equal(kept.length, 3);
    assert.equal(kept[0]?.id, "e7");
  });
});
