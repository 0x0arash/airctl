import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DetectorRegistry } from "../src/detectors/registry.js";
import type { DetectionContext } from "../src/detectors/types.js";
import type { ProcessInfo, Project } from "../src/domain/types.js";

const project: Project = {
  id: "p",
  root: "/shop",
  name: "shop",
  markers: ["package.json"],
};

function ctx(
  partial: Partial<DetectionContext> & { command: string; executable: string },
): DetectionContext {
  const process: ProcessInfo = {
    pid: 9,
    availability: "ok",
    executable: partial.executable,
    command: partial.command,
    cwd: "/shop",
  };
  return {
    process,
    project: partial.project ?? project,
    ports: partial.ports ?? [],
    command: partial.command,
    executable: partial.executable,
  };
}

describe("builtin detectors", () => {
  const registry = new DetectorRegistry();

  it("detects common development servers", () => {
    assert.equal(
      registry.detect(ctx({ command: "vite --port 5173", executable: "node", ports: [5173] }))
        ?.name,
      "Vite",
    );
    assert.equal(
      registry.detect(ctx({ command: "next dev", executable: "node", ports: [3000] }))?.name,
      "Next.js",
    );
    assert.equal(registry.detect(ctx({ command: "nuxt dev", executable: "node" }))?.name, "Nuxt");
    assert.equal(registry.detect(ctx({ command: "astro dev", executable: "node" }))?.name, "Astro");
    assert.equal(
      registry.detect(ctx({ command: "node server.js", executable: "node" }))?.name,
      "Node.js",
    );
  });

  it("detects data stores by executable and well-known ports", () => {
    assert.equal(
      registry.detect(ctx({ command: "postgres", executable: "postgres", ports: [5432] }))
        ?.classification,
      "database",
    );
    assert.equal(
      registry.detect(ctx({ command: "redis-server", executable: "redis-server", ports: [6379] }))
        ?.name,
      "Redis",
    );
    assert.equal(
      registry.detect(ctx({ command: "mongod", executable: "mongod", ports: [27017] }))?.name,
      "MongoDB",
    );
  });

  it("detects WSL relays as proxies", () => {
    const hit = registry.detect(
      ctx({ command: "wslrelay", executable: "wslrelay.exe", ports: [3000] }),
    );
    assert.equal(hit?.name, "WSL");
    assert.equal(hit?.classification, "proxy");
  });
});
