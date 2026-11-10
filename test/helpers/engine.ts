import { DiscoveryEngine, type EngineDeps } from "../../src/engine/engine.js";
import { MemoryFileSystem } from "../../src/runtime/fs.js";
import { FrozenClock } from "../../src/runtime/clock.js";
import { FakeCommandRunner } from "../../src/runtime/spawn.js";
import { MapEnv } from "../../src/runtime/env.js";
import { StaticProcessProvider } from "../../src/process/provider.js";
import { StaticSocketProvider } from "../../src/network/provider.js";
import { UnavailableContainerProvider } from "../../src/docker/provider.js";
import type { ListeningSocket } from "../../src/domain/types.js";

export function testEngine(deps: Partial<EngineDeps> = {}) {
  return new DiscoveryEngine({
    runtime: {
      fs: new MemoryFileSystem(),
      clock: new FrozenClock(new Date("2026-11-10T12:00:00Z")),
      commands: new FakeCommandRunner(),
      env: new MapEnv(),
      platform: "linux",
      homedir: () => "/home/dev",
      tmpdir: () => "/tmp",
    },
    processes: new StaticProcessProvider(),
    sockets: new StaticSocketProvider(),
    projects: { detectFromProcesses: async () => [], inspectRoot: async () => undefined },
    containers: new UnavailableContainerProvider(),
    ...deps,
  });
}

export function socket(
  pid: number,
  port: number,
  address = "127.0.0.1",
  protocol: "tcp" | "udp" = "tcp",
): ListeningSocket {
  return {
    id: `${pid}:${address}:${port}:${protocol}`,
    pid,
    port,
    address,
    bindAddress: address,
    protocol,
    family: address.includes(":") ? "ipv6" : "ipv4",
    scope: address === "127.0.0.1" ? "loopback" : "unspecified",
  };
}
