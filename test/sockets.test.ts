import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProcNet, parseProcNetEstablished } from "../src/network/linux.js";
import { parseLsofFields, parseLsofName } from "../src/network/darwin.js";
import { parseNetstat } from "../src/network/windows.js";

describe("socket parsers", () => {
  it("parses linux /proc/net/tcp listen rows", () => {
    const text = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1
   1: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 999 1
   2: 0100007F:0BB8 0100007F:1234 01 00000000:00000000 00:00000000 00000000     0        0 1 1
`;
    const rows = parseProcNet(text, "tcp", "ipv4");
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.socket.address, "127.0.0.1");
    assert.equal(rows[0]?.socket.port, 3000);
    assert.equal(rows[0]?.socket.scope, "loopback");
    assert.equal(rows[1]?.socket.address, "0.0.0.0");
    assert.equal(rows[1]?.socket.port, 8080);
    assert.equal(rows[1]?.socket.scope, "unspecified");
  });

  it("parses lsof field output", () => {
    const text = ["p18472", "cnode", "n127.0.0.1:3000", "p99", "cnginx", "n*:80"].join("\n");
    const sockets = parseLsofFields(text);
    assert.equal(sockets[0]?.pid, 18472);
    assert.equal(sockets[0]?.port, 3000);
    assert.equal(sockets[1]?.address, "0.0.0.0");
    assert.equal(parseLsofName("[::1]:5173")?.family, "ipv6");
  });

  it("parses windows netstat", () => {
    const text = `
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4212
  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       1001
  TCP    [::]:443               [::]:0                 LISTENING       4
  TCP    127.0.0.1:5173         127.0.0.1:9            ESTABLISHED     4212
`;
    const parsed = parseNetstat(text);
    const sockets = parsed.listening;
    assert.equal(sockets.length, 3);
    assert.equal(sockets[0]?.port, 5173);
    assert.equal(sockets[0]?.scope, "loopback");
    assert.equal(sockets[1]?.scope, "unspecified");
    assert.equal(sockets[2]?.family, "ipv6");
    assert.equal(parsed.connections.length, 1);
    assert.equal(parsed.connections[0]?.remotePort, 9);
  });

  it("parses windows UDP listeners", () => {
    const text = `
  UDP    0.0.0.0:5353           *:*                                    4784
  UDP    [::]:1900              *:*                                    1234
`;
    const { listening } = parseNetstat(text);
    assert.equal(listening.length, 2);
    assert.equal(listening[0]?.protocol, "udp");
    assert.equal(listening[0]?.port, 5353);
    assert.equal(listening[1]?.family, "ipv6");
  });

  it("parses linux established connections", () => {
    const text = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:C350 0100007F:1538 01 00000000:00000000 00:00000000 00000000     0        0 42 1
`;
    const rows = parseProcNetEstablished(text, "ipv4");
    assert.equal(rows[0]?.connection.localPort, 50000);
    assert.equal(rows[0]?.connection.remotePort, 5432);
    assert.equal(rows[0]?.connection.remoteAddress, "127.0.0.1");
  });
});
