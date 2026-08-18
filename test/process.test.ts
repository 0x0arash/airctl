import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseStatus } from "../src/process/linux.js";
import { parseWindowsCim, parseCimDate, parseTasklist } from "../src/process/windows.js";
import { buildProcessTree, descendantsOf, isShellName } from "../src/process/tree.js";
import type { ProcessInfo } from "../src/domain/types.js";

describe("process parsing", () => {
  it("parses /proc status", () => {
    const parsed = parseStatus(`Name:\tnode
Umask:\t0022
State:\tS
Tgid:\t18472
PPid:\t1200
Uid:\t1000\t1000\t1000\t1000
VmRSS:\t  12345 kB
`);
    assert.equal(parsed.name, "node");
    assert.equal(parsed.ppid, 1200);
    assert.equal(parsed.vmRssBytes, 12345 * 1024);
  });

  it("parses windows CIM lines", () => {
    const procs = parseWindowsCim(
      "18472\t1200\tnode.exe\tC:\\\\node\\\\node.exe\tnode --port 3000\t111\t20240101120000.000000-000\n",
    );
    assert.equal(procs[0]?.pid, 18472);
    assert.equal(procs[0]?.parentPid, 1200);
    assert.ok(procs[0]?.command?.includes("node"));
  });

  it("parses CIM dates and tasklist", () => {
    assert.ok(parseCimDate("20240101120000.000000-000")?.startsWith("2024-01-01"));
    const list = parseTasklist('"node.exe","18472","RDP-Tcp#0","1","80,000 K"');
    assert.equal(list[0]?.pid, 18472);
  });

  it("builds process trees", () => {
    const procs: ProcessInfo[] = [
      { pid: 1, availability: "ok", executable: "init" },
      { pid: 10, parentPid: 1, availability: "ok", executable: "zsh" },
      { pid: 20, parentPid: 10, availability: "ok", executable: "node" },
      { pid: 21, parentPid: 20, availability: "ok", executable: "node" },
    ];
    const tree = buildProcessTree(procs);
    assert.equal(descendantsOf(10, tree).length, 2);
    assert.equal(isShellName("zsh"), true);
    assert.equal(isShellName("node"), false);
  });
});
