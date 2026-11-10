import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => listener.close(resolve));
}
