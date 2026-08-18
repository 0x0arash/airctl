import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryFileSystem } from "../src/runtime/fs.js";
import { FilesystemProjectDetector, projectByCwd } from "../src/projects/detect.js";
import { DetectorRegistry } from "../src/detectors/registry.js";
import { classifyServices } from "../src/classification/classify.js";
import type { ListeningSocket, ProcessInfo } from "../src/domain/types.js";
import { socketIdFor } from "../src/domain/ids.js";

describe("project and framework detection", () => {
  it("walks ancestors for package.json and git", async () => {
    const fs = new MemoryFileSystem();
    fs.addDir("/home/dev/code/shop");
    fs.addDir("/home/dev/code/shop/.git");
    fs.addFile("/home/dev/code/shop/.git/config", "");
    fs.addFile("/home/dev/code/shop/package.json", '{"name":"shop"}');
    fs.addFile("/home/dev/code/shop/vite.config.ts", "");
    fs.addDir("/home/dev/code/shop/apps/web");
    const detector = new FilesystemProjectDetector(fs);
    const projects = await detector.detectFromProcesses([
      { pid: 1, cwd: "/home/dev/code/shop/apps/web", availability: "ok" },
    ]);
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.name, "shop");
    assert.ok(projects[0]?.markers.includes("package.json"));
    assert.ok(projects[0]?.markers.includes("framework:Vite"));
  });

  it("does not invent a project without markers", async () => {
    const fs = new MemoryFileSystem();
    fs.addDir("/tmp/random");
    const detector = new FilesystemProjectDetector(fs);
    const projects = await detector.detectFromProcesses([
      { pid: 1, cwd: "/tmp/random", availability: "ok" },
    ]);
    assert.equal(projects.length, 0);
  });

  it("detects vite with high confidence", () => {
    const registry = new DetectorRegistry();
    const hit = registry.detect({
      process: {
        pid: 9,
        availability: "ok",
        executable: "node",
        command: "vite --port 5173",
        cwd: "/shop",
      },
      project: {
        id: "p",
        root: "/shop",
        name: "shop",
        markers: ["package.json", "framework:Vite"],
      },
      ports: [5173],
      command: "vite --port 5173",
      executable: "node",
    });
    assert.equal(hit?.name, "Vite");
    assert.ok((hit?.confidence ?? 0) >= 0.85);
  });

  it("classifies postgres on 5432", () => {
    const proc: ProcessInfo = {
      pid: 50,
      executable: "postgres",
      command: "postgres",
      availability: "ok",
    };
    const socket: ListeningSocket = {
      id: socketIdFor({ family: "ipv4", address: "127.0.0.1", port: 5432, protocol: "tcp" }),
      address: "127.0.0.1",
      port: 5432,
      protocol: "tcp",
      pid: 50,
      family: "ipv4",
      bindAddress: "127.0.0.1",
      scope: "loopback",
    };
    const services = classifyServices({
      processes: [proc],
      sockets: [socket],
      projects: [],
      detectors: new DetectorRegistry(),
    });
    assert.equal(services[0]?.classification, "database");
    assert.equal(services[0]?.framework?.name, "Postgres");
  });

  it("does not call a docker-proxy's :5432 Redis just because :6379 is on the same PID", () => {
    const proc: ProcessInfo = {
      pid: 17848,
      executable: "com.docker.backend",
      command: "com.docker.backend",
      availability: "ok",
    };
    const sock = (port: number): ListeningSocket => ({
      id: socketIdFor({ family: "ipv4", address: "0.0.0.0", port, protocol: "tcp" }),
      address: "0.0.0.0",
      port,
      protocol: "tcp",
      pid: 17848,
      family: "ipv4",
      bindAddress: "0.0.0.0",
      scope: "unspecified",
    });
    const services = classifyServices({
      processes: [proc],
      sockets: [sock(5432), sock(6379)],
      projects: [],
      detectors: new DetectorRegistry(),
    });
    const pg = services.find((s) => s.socketIds.includes(sock(5432).id));
    const redis = services.find((s) => s.socketIds.includes(sock(6379).id));
    assert.equal(pg?.framework?.name, "Postgres");
    assert.equal(pg?.classification, "database");
    assert.equal(redis?.framework?.name, "Redis");
    assert.equal(redis?.classification, "cache");
  });

  it("associates cwd with the longest matching project root", () => {
    const projects = [
      { id: "a", root: "/code", name: "code", markers: [] },
      { id: "b", root: "/code/shop", name: "shop", markers: [] },
    ];
    assert.equal(projectByCwd(projects, "/code/shop/apps/web")?.name, "shop");
  });
});
