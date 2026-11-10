import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";

const temporary = await mkdtemp(path.join(tmpdir(), "airctl-package-"));
let server;
try {
  const npmCli = process.env.npm_execpath;
  const npm = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const output = execFileSync(
    npm,
    [
      ...(npmCli ? [npmCli] : []),
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      temporary,
    ],
    {
      encoding: "utf8",
      shell: !npmCli && process.platform === "win32",
    },
  );
  const parsed = JSON.parse(output.slice(output.lastIndexOf("\n[") + 1));
  // npm 10 returns an array; newer npm versions key results by package name.
  const packed = Array.isArray(parsed) ? parsed : Object.values(parsed);
  assert.equal(typeof packed[0]?.filename, "string", "npm pack did not return a tarball filename");
  execFileSync("tar", ["-xf", path.join(temporary, packed[0].filename), "-C", temporary]);
  const root = path.join(temporary, "package");
  const { startServer } = await import(pathToFileURL(path.join(root, "dist/server/http.js")));
  const { defaultConfig } = await import(pathToFileURL(path.join(root, "dist/config/load.js")));
  const manifest = JSON.parse(
    execFileSync(process.execPath, [path.join(root, "dist/cli.js"), "version", "--json"], {
      encoding: "utf8",
    }),
  );
  assert.equal(manifest.name, "airctl");
  server = await startServer({
    port: 0,
    openBrowser: false,
    app: {
      config: defaultConfig,
      engine: { onChange: () => () => {}, startAdaptiveLoop() {}, stopLoop() {} },
    },
  });
  const url = new URL(server.url);
  assert.ok(url.hash.includes(server.token));
  const response = await fetch(url);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /assets\/main.js/);
  assert.doesNotMatch(html, /id="refresh"/);
  for (const file of ["assets/main.js", "assets/main.css"]) {
    const asset = await fetch(new URL(file, url));
    assert.equal(asset.status, 200);
    assert.ok((await asset.text()).length > 100);
  }
  const { runSession } = await import(pathToFileURL(path.join(root, "dist/session/server.js")));
  const input = new PassThrough();
  const sessionOutput = new PassThrough();
  const frames = [];
  let buffered = "";
  let snapshotReceived;
  const received = new Promise((resolve) => {
    snapshotReceived = resolve;
  });
  sessionOutput.setEncoding("utf8");
  sessionOutput.on("data", (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const frame = JSON.parse(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      frames.push(frame);
      if (frame.type === "snapshot") snapshotReceived();
    }
  });
  const empty = {
    scannedAt: new Date().toISOString(),
    durationMs: 0,
    services: [],
    projects: [],
    sockets: [],
    warnings: [],
    events: [],
    capabilities: {},
    summary: {},
  };
  const session = runSession(
    { engine: { scan: async () => empty } },
    { input, output: sessionOutput, fast: true },
  );
  await received;
  input.end();
  await session;
  assert.equal(frames[0].type, "ready");
  assert.equal(frames[0].protocol, 1);
  assert.deepEqual(frames.find((frame) => frame.type === "snapshot").data.services, []);
  console.log(
    `Packed airctl ${manifest.version}: CLI, live session, and bundled web assets verified`,
  );
} finally {
  await server?.close();
  await rm(temporary, { recursive: true, force: true });
}
