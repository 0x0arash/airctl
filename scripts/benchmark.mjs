import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
const run = promisify(execFile);
const sockets = new Set();
const listener = createServer((socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  socket.end();
});
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
const results = [];
try {
  for (const args of [
    ["version", "--json"],
    ["status", "--json"],
    ["status", "--fast", "--json"],
    ["explain", `:${port}`, "--json"],
    ["explain", ":65534", "--json"],
    ["inspect", String(process.pid), "--json"],
  ]) {
    const samples = [];
    for (let index = 0; index < 3; index++) {
      const start = performance.now();
      try {
        await run(process.execPath, ["dist/cli.js", ...args], {
          maxBuffer: 16 * 1024 * 1024,
          timeout: 30000,
        });
      } catch (error) {
        if (args[0] !== "explain" || error.code !== 3) throw error;
      }
      samples.push(Math.round(performance.now() - start));
    }
    samples.sort((a, b) => a - b);
    results.push({
      command: args.filter((arg) => arg !== "--json").join(" "),
      medianMs: samples[1],
      slowestMs: samples[2],
    });
  }
  console.table(results);
  const started = performance.now();
  const child = spawn(process.execPath, ["dist/cli.js", "session", "--json", "--fast"], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let ready;
  const snapshot = new Promise((resolve, reject) => {
    ready = resolve;
    child.once("error", reject);
    child.once("close", () => reject(new Error("Live session exited before a snapshot")));
  });
  lines.on("line", (line) => {
    const frame = JSON.parse(line);
    if (frame.type === "snapshot") ready();
    if (frame.type === "response") {
      const resolve = pending.get(frame.id);
      pending.delete(frame.id);
      if (resolve) resolve(frame);
    }
  });
  let deadline;
  const timeout = new Promise((_resolve, reject) => {
    deadline = setTimeout(() => reject(new Error("Live-session benchmark timed out")), 15000);
  });
  try {
    await Promise.race([snapshot, timeout]);
    const firstSnapshotMs = Math.round(performance.now() - started);
    const cached = [];
    for (let index = 0; index < 100; index++) {
      const id = String(index);
      const response = new Promise((resolve) => pending.set(id, resolve));
      const start = performance.now();
      child.stdin.write(JSON.stringify({ id, method: "status" }) + "\n");
      const frame = await Promise.race([response, timeout]);
      if (frame.error) throw new Error(frame.error.message);
      cached.push(performance.now() - start);
    }
    cached.sort((a, b) => a - b);
    console.log({
      liveSession: {
        processes: 1,
        firstSnapshotMs,
        cachedStatusMedianMs: Number(cached[50].toFixed(2)),
        reads: cached.length,
      },
    });
  } finally {
    clearTimeout(deadline);
    const exited =
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("close", resolve));
    child.stdin.end();
    const kill = setTimeout(() => child.kill(), 5000);
    try {
      await exited;
    } finally {
      clearTimeout(kill);
      lines.close();
    }
  }
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => listener.close(resolve));
}
