import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLoopbackHost, originAllowed } from "../src/shared/api.js";
import { parseArgv, helpText } from "../src/cli/parse.js";
import { formatExplanation } from "../src/engine/explain.js";
import { formatDoctor } from "../src/engine/doctor.js";

describe("api guards", () => {
  it("allows only loopback hosts and matching origins", () => {
    assert.equal(isLoopbackHost("127.0.0.1:4114"), true);
    assert.equal(isLoopbackHost("localhost:4114"), true);
    assert.equal(isLoopbackHost("192.168.1.5:4114"), false);
    assert.equal(originAllowed("http://127.0.0.1:4114", "127.0.0.1", 4114), true);
    assert.equal(originAllowed("http://evil.example:4114", "127.0.0.1", 4114), false);
    assert.equal(originAllowed(undefined, "127.0.0.1", 4114), true);
  });
});

describe("cli help and explain formatting", () => {
  it("documents required commands", () => {
    const help = helpText();
    for (const cmd of ["status", "explain", "inspect", "doctor", "graph"]) {
      assert.match(help, new RegExp(cmd));
    }
    assert.equal(parseArgv(["--json", "status"]).flags.json, true);
  });

  it("formats a free port and occupied port", () => {
    const free = formatExplanation(
      { port: 3000, occupied: false, sockets: [], actions: [] },
      Date.parse("2026-01-01"),
    );
    assert.match(free, /FREE/);
    const occupied = formatExplanation(
      {
        port: 3000,
        occupied: true,
        sockets: [
          {
            id: "s",
            address: "127.0.0.1",
            port: 3000,
            protocol: "tcp",
            family: "ipv4",
            bindAddress: "127.0.0.1",
            scope: "loopback",
          },
        ],
        process: { pid: 18472, executable: "node", command: "npm run dev", availability: "ok" },
        project: { id: "p", root: "/code/old-blog", name: "old-blog", markers: [] },
        classification: "development-server",
        confidence: 0.9,
        likelyIssue: "This appears to be an old development server.",
        actions: ["airctl stop 18472"],
      },
      Date.parse("2026-01-01"),
    );
    assert.match(occupied, /OCCUPIED/);
    assert.match(occupied, /PID 18472/);
  });

  it("formats doctor output", () => {
    const text = formatDoctor({
      platform: "linux",
      nodeVersion: "v22.18.0",
      checks: [{ name: "Process discovery", ok: true, detail: "ok" }],
      warnings: [],
    });
    assert.match(text, /AIRCTL DOCTOR/);
  });
});

// Exercise the actual entry point, including package-manager-style command links.
describe("CLI invocation", () => {
  it("accepts a private fast JSON session", () => {
    const parsed = parseArgv(["session", "--fast", "--json"]);
    assert.equal(parsed.command, "session");
    assert.equal(parsed.flags.fast, true);
    assert.equal(parsed.flags.json, true);
  });
  it("runs through a symlink named airctl", async () => {
    const { mkdtemp, symlink, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { execFileSync } = await import("node:child_process");
    const dir = await mkdtemp(path.join(tmpdir(), "airctl-cli-"));
    try {
      const link = path.join(dir, "airctl");
      await symlink(fileURLToPath(new URL("../src/cli.ts", import.meta.url)), link);
      const output = execFileSync(process.execPath, ["--import", "tsx", link, "--version"], {
        encoding: "utf8",
      });
      assert.match(output, /^airctl \d+\.\d+\.\d+\n$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed flags and unknown commands before discovery", () => {
    for (const args of [
      ["--config"],
      ["--config="],
      ["--project", "--json"],
      ["--port", "70000"],
      ["--port", "abc"],
      ["statsu"],
    ]) {
      assert.throws(() => parseArgv(args));
    }
  });

  it("returns structured errors for invalid arguments and startup failures", async () => {
    const { runCli } = await import("../src/cli.js");
    let stdout = "";
    let stderr = "";
    const io = {
      stdout: {
        write: (text: string) => {
          stdout += text;
        },
      },
      stderr: {
        write: (text: string) => {
          stderr += text;
        },
      },
    } as unknown as { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream };
    for (const args of [
      ["--json", "--oops"],
      ["--json", "--config", "/nonexistent/airctl-test.json"],
    ]) {
      stdout = "";
      assert.equal(await runCli(args, io), 2);
      assert.equal(JSON.parse(stdout).error.code, "INVALID_INPUT");
      assert.equal(stderr, "");
    }
  });
});
