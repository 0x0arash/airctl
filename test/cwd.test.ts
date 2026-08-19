import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferCwdFromCommand, parsePidCwdTable } from "../src/process/cwd.js";
import { attachInferredCwds } from "../src/process/windows.js";
import { parseNetshPortProxy, isWslHelperName } from "../src/network/portproxy.js";
import { annotateWindowsForward } from "../src/network/windows.js";
import { FilesystemProjectDetector } from "../src/projects/detect.js";
import { MemoryFileSystem } from "../src/runtime/fs.js";

describe("cwd inference", () => {
  it("takes the project root from a Windows node_modules vite path", () => {
    const cwd = inferCwdFromCommand(
      String.raw`node  C:\Users\dev\code\shop\node_modules\vite\bin\vite.js --port 5173`,
      String.raw`C:\Program Files\nodejs\node.exe`,
    );
    assert.equal(cwd, String.raw`C:\Users\dev\code\shop`);
  });

  it("uses --cwd and script directories", () => {
    assert.equal(inferCwdFromCommand("npm run dev --cwd /home/dev/shop"), "/home/dev/shop");
    assert.equal(
      inferCwdFromCommand("python /home/dev/code/api/manage.py runserver"),
      "/home/dev/code/api",
    );
  });

  it("parses pid/cwd tables from PowerShell", () => {
    const map = parsePidCwdTable("4212\tC:\\code\\shop\n99\t/tmp\n");
    assert.equal(map.get(4212), "C:\\code\\shop");
  });

  it("attaches inferred cwd onto Windows process records", () => {
    const [proc] = attachInferredCwds([
      {
        pid: 8,
        executable: "node.exe",
        command: String.raw`node C:\work\app\server.js`,
        availability: "ok",
      },
    ]);
    assert.equal(proc?.cwd, String.raw`C:\work\app`);
    assert.equal(proc?.cwdKind, "inferred");
  });
});

describe("project seeds without cwd", () => {
  it("finds a project from the command line alone", async () => {
    const fs = new MemoryFileSystem();
    fs.addDir("/code/shop");
    fs.addFile("/code/shop/package.json", "{}");
    const detector = new FilesystemProjectDetector(fs);
    const projects = await detector.detectFromProcesses([
      {
        pid: 1,
        executable: "node",
        command: "node /code/shop/node_modules/vite/bin/vite.js",
        availability: "ok",
      },
    ]);
    assert.equal(projects[0]?.name, "shop");
  });
});

describe("windows portproxy and WSL", () => {
  it("parses netsh portproxy tables", () => {
    const text = `
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         3000        172.24.12.5     3000
`;
    const [rule] = parseNetshPortProxy(text);
    assert.equal(rule?.listenPort, 3000);
    assert.equal(rule?.connectAddress, "172.24.12.5");
  });

  it("labels wslrelay listeners as WSL forwards", () => {
    assert.equal(isWslHelperName("wslrelay.exe"), true);
    const socket = annotateWindowsForward(
      {
        id: "s",
        address: "127.0.0.1",
        port: 3000,
        protocol: "tcp",
        pid: 44,
        family: "ipv4",
        bindAddress: "127.0.0.1",
        scope: "loopback",
      },
      [],
      { pid: 44, executable: "wslrelay.exe", availability: "ok" },
    );
    assert.equal(socket.forwarded?.kind, "wsl");
  });
});
