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
