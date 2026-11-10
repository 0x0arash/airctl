import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PassThrough } from "node:stream";
import { EventEmitter, once } from "node:events";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { runSession } from "../src/session/server.js";
import { testEngine, socket } from "./helpers/engine.js";
import { loadBundled } from "./helpers/bundle.js";
import { StaticProcessProvider } from "../src/process/provider.js";
import { StaticSocketProvider } from "../src/network/provider.js";
import type { AppContext } from "../src/engine/app.js";
import { DiscoverySession } from "../vscode-extension/src/session.js";

const pause = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function deadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const proc = { pid: 101, executable: "node", command: "node api.js", availability: "ok" as const };

function fixture() {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: any[] = [];
  let buffer = "";
  let stops = 0;
  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      frames.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  const processes = new StaticProcessProvider([proc]);
  const sockets = new StaticSocketProvider([socket(101, 3000)]);
  const engine = testEngine({ processes, sockets });
  const app = {
    engine,
    controller: {
      stop: async () => {
        stops++;
        return { stopped: true, signal: "SIGTERM" };
      },
    },
  } as unknown as AppContext;
  const running = runSession(app, { input, output, fast: true });
  const wait = async (predicate: (frame: any) => boolean) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const frame = frames.find(predicate);
      if (frame) return frame;
      await pause(5);
    }
    throw new Error("Session frame did not arrive");
  };
  return {
    input,
    frames,
    processes,
    sockets,
    engine,
    wait,
    stops: () => stops,
    send: (request: unknown) => input.write(JSON.stringify(request) + "\n"),
    close: async () => {
      input.end();
      await running;
      await engine.close();
    },
    running,
  };
}

describe("private discovery session server", () => {
  it("shares snapshots, refreshes explicitly, and queries live port owners", async () => {
    const session = fixture();
    try {
      assert.equal((await session.wait((frame) => frame.type === "ready")).protocol, 1);
      await session.wait((frame) => frame.type === "snapshot");
      session.send({ id: "1", method: "status" });
      const response = await session.wait((frame) => frame.id === "1");
      assert.equal(response.result.services[0].processId, 101);
      const count = session.frames.filter((frame) => frame.type === "snapshot").length;
      session.send({ id: "2", method: "status" });
      await session.wait((frame) => frame.id === "2");
      assert.equal(session.frames.filter((frame) => frame.type === "snapshot").length, count);
      session.sockets.set([]);
      session.send({ id: "3", method: "explain", port: 3000 });
      assert.equal((await session.wait((frame) => frame.id === "3")).result.occupied, false);
      session.send({ id: "4", method: "refresh" });
      assert.equal((await session.wait((frame) => frame.id === "4")).result.services.length, 0);
    } finally {
      await session.close();
    }
  });

  it("requires confirmation for stop and validates requests without terminating processes automatically", async () => {
    const session = fixture();
    try {
      session.send({ id: "no", method: "stop", pid: 101 });
      assert.equal(
        (await session.wait((frame) => frame.id === "no")).error.code,
        "CONFIRMATION_REQUIRED",
      );
      assert.equal(session.stops(), 0);
      session.send({ id: "bad", method: "configure", intervalMs: 0 });
      assert.equal((await session.wait((frame) => frame.id === "bad")).error.code, "INVALID_INPUT");
      session.send({ id: "yes", method: "stop", pid: 101, confirm: true });
      assert.equal(
        (await session.wait((frame) => frame.id === "yes")).result.stopped[0].stopped,
        true,
      );
      assert.equal(session.stops(), 1);
    } finally {
      await session.close();
    }
  });

  it("closes on EOF and rejects oversized requests", async () => {
    const session = fixture();
    session.input.write("x".repeat(65 * 1024));
    await session.running;
    assert.equal(session.stops(), 0);
    await session.close();
  });
  it("can stop while its reader is backpressured", async () => {
    const input = new PassThrough();
    const output = new PassThrough({ highWaterMark: 1 });
    const engine = testEngine();
    const running = runSession({ engine } as AppContext, { input, output, fast: true });
    input.end();
    await deadline(running, 1000, "Session ignored EOF under output backpressure");
    output.destroy();
    await engine.close();
  });
});

function fakeChild(ready = true) {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = () => {
    child.exitCode = 0;
    child.emit("close", 0);
  };
  child.stdin.on("end", () => {
    child.exitCode = 0;
    child.emit("close", 0);
  });
  child.stdin.resume();
  const methods: string[] = [];
  let buffer = "";
  const status = {
    version: 1,
    scannedAt: "2026-11-10T12:00:00Z",
    services: [],
    summary: { services: 0 },
  };
  child.stdin.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const request = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      methods.push(request.method);
      if (request.method === "stop") continue;
      if (request.method === "status" || request.method === "refresh")
        child.stdout.write(JSON.stringify({ type: "snapshot", data: status }) + "\n");
      child.stdout.write(
        JSON.stringify({
          type: "response",
          id: request.id,
          result: request.method === "configure" ? {} : status,
        }) + "\n",
      );
    }
  });
  if (ready) queueMicrotask(() => child.stdout.write('{"type":"ready","protocol":1}\n'));
  return { child, methods, status };
}

describe("editor session lifecycle", () => {
  it("reuses one process and clears cached snapshots on disconnect without replaying stop", async () => {
    const children: ReturnType<typeof fakeChild>[] = [];
    const errors: Error[] = [];
    const updates: unknown[] = [];
    const client = new DiscoverySession<any>({
      launch: () => {
        const child = fakeChild();
        children.push(child);
        return child.child;
      },
      validate: (value): value is any => !!value && typeof value === "object",
      onSnapshot: (status) => updates.push(status),
      onError: (error) => errors.push(error),
      intervalMs: 2000,
      retryMs: 20,
    });
    try {
      client.start();
      await client.status();
      await Promise.all(Array.from({ length: 100 }, () => client.status()));
      assert.equal(children.length, 1);
      const mutation = client.request("stop", { pid: 101, confirm: true });
      const rejected = assert.rejects(mutation, /exited/);
      await pause();
      children[0]!.child.emit("close", 1);
      await rejected;
      await assert.rejects(client.status(), /reconnecting/);
      await pause(60);
      await client.status();
      assert.equal(children.length, 2);
      assert.ok(errors.length >= 1);
      assert.ok(updates.length >= 2);
      assert.deepEqual(
        children[1]!.methods.filter((method) => method === "stop"),
        [],
      );
    } finally {
      client.dispose();
    }
  });

  it("forces cleanup only of its own helper when EOF is ignored", async () => {
    const fake = fakeChild();
    fake.child.stdin.removeAllListeners("end");
    let signal: string | undefined;
    fake.child.kill = (value: string) => {
      signal = value;
      fake.child.exitCode = 0;
      fake.child.emit("close", 0);
    };
    const client = new DiscoverySession<unknown>({
      launch: () => fake.child,
      validate: (_value): _value is unknown => true,
      onSnapshot() {},
      onError() {},
      intervalMs: 2000,
      shutdownTimeoutMs: 10,
    });
    client.start();
    await client.status();
    client.dispose();
    await pause(30);
    assert.equal(signal, "SIGKILL");
  });

  it("does not restart an unsupported legacy CLI", async () => {
    let count = 0;
    let unsupported = false;
    const client = new DiscoverySession<any>({
      launch: () => {
        count++;
        const child = fakeChild();
        queueMicrotask(() =>
          child.child.stdout.write(
            '{"error":{"code":"INVALID_INPUT","message":"Unknown command: session"}}\n',
          ),
        );
        return child.child;
      },
      validate: (value): value is any => !!value,
      onSnapshot() {},
      onError: (error) => {
        unsupported ||= error.unsupported === true;
      },
      intervalMs: 2000,
      retryMs: 5,
    });
    client.start();
    await pause(30);
    assert.equal(unsupported, true);
    assert.equal(count, 1);
    client.dispose();
  });
});

describe("legacy editor compatibility", () => {
  it("falls back to polling and retries without --fast for an older CLI", async () => {
    const child = fakeChild(false);
    const calls: string[][] = [];
    const status = {
      version: 1,
      scannedAt: "2026-11-10T12:00:00Z",
      services: [],
      projects: [],
      summary: { services: 0 },
    };
    let received!: () => void;
    const first = new Promise<void>((resolve) => {
      received = resolve;
    });
    const extension = loadBundled("vscode-extension/src/airctl.ts", {
      vscode: {
        workspace: {
          getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
        },
      },
      "node:fs": { existsSync: () => false },
      "node:child_process": {
        spawn: () => {
          queueMicrotask(() =>
            child.child.stdout.write(
              '{"error":{"code":"INVALID_INPUT","message":"Unknown command: session"}}\n',
            ),
          );
          return child.child;
        },
        execFile: (_cmd: string, args: string[], _options: unknown, callback: Function) => {
          calls.push(args);
          if (args.includes("--fast"))
            callback(
              Object.assign(new Error("exit 2"), { code: 2 }),
              '{"error":{"code":"INVALID_INPUT","message":"Unknown flag: --fast"}}',
              "",
            );
          else callback(null, JSON.stringify(status), "");
        },
      },
    });
    const connection = extension.startDiscovery!(
      () => received(),
      () => assert.fail("Legacy fallback must remain usable"),
    );
    try {
      await deadline(first, 1000, "Legacy inventory not received");
      assert.equal(calls.length, 2);
      assert.ok(calls[0]!.includes("--fast"));
      assert.ok(!calls[1]!.includes("--fast"));
      assert.equal(child.child.stdin.writableEnded, true);
    } finally {
      connection.dispose();
    }
  });
});

describe("editor session over actual child pipes", () => {
  it("shares a live scanner for cached status and fresh actions, and shuts it down on disposal", async () => {
    const root = process.cwd();
    const helperUrl = pathToFileURL(path.join(root, "test/helpers/engine.ts")).href;
    const serverUrl = pathToFileURL(path.join(root, "src/session/server.ts")).href;
    const processesUrl = pathToFileURL(path.join(root, "src/process/provider.ts")).href;
    const socketsUrl = pathToFileURL(path.join(root, "src/network/provider.ts")).href;
    const script = `import {testEngine,socket} from ${JSON.stringify(helperUrl)};
import {runSession} from ${JSON.stringify(serverUrl)};
import {StaticProcessProvider} from ${JSON.stringify(processesUrl)};
import {StaticSocketProvider} from ${JSON.stringify(socketsUrl)};
const engine=testEngine({processes:new StaticProcessProvider([${JSON.stringify(proc)}]),sockets:new StaticSocketProvider([socket(101,3000)])});
await runSession({engine,controller:{stop:async()=>({stopped:true,signal:'SIGTERM'})}},{input:process.stdin,output:process.stdout,fast:true});await engine.close();`;
    let children = 0;
    let child: ReturnType<typeof spawn> | undefined;
    let received!: () => void;
    const first = new Promise<void>((resolve) => {
      received = resolve;
    });
    const extension = loadBundled("vscode-extension/src/airctl.ts", {
      vscode: {
        workspace: {
          getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
        },
      },
      "node:fs": { existsSync: () => false },
      "node:child_process": {
        spawn: (_cmd: string, args: string[]) => {
          children++;
          assert.ok(args.includes("session"));
          child = spawn(
            process.execPath,
            ["--import", "tsx", "--input-type=module", "-e", script],
            { stdio: "pipe", cwd: root },
          );
          return child;
        },
        execFile: () => {
          throw new Error("One-shot CLI must not run while live discovery is active");
        },
      },
    });
    const errors: Error[] = [];
    let cleanupError: Error | undefined;
    const connection = extension.startDiscovery!(
      () => received(),
      (error: Error) => errors.push(error),
    );
    try {
      await deadline(first, 5000, "No live snapshot");
      const statuses = await Promise.all(Array.from({ length: 100 }, () => extension.getStatus!()));
      assert.equal(statuses[0].services[0].processId, 101);
      assert.equal((await extension.explainPort!(3000)).process.pid, 101);
      assert.equal((await extension.stopProcess!(101)).stopped[0].stopped, true);
      await extension.refreshStatus!();
      assert.equal(children, 1);
      assert.deepEqual(errors, []);
    } finally {
      const closed = child ? once(child, "close") : Promise.resolve();
      connection.dispose();
      try {
        await deadline(closed, 3000, "Session did not exit after EOF");
      } catch (error) {
        child?.kill();
        cleanupError = error as Error;
      }
    }
    if (cleanupError) assert.fail(cleanupError.message);
  });
});
