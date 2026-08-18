import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
  bindScope,
  formatEndpoint,
  parseEndpoint,
  parseHexIPv4,
  parseHexIPv6,
  parsePort,
  parsePortArg,
} from "../src/network/parse.js";

describe("port parsing", () => {
  it("accepts 1-65535", () => {
    assert.equal(parsePort(80), 80);
    assert.equal(parsePortArg(":3000"), 3000);
    assert.equal(parsePortArg("8080"), 8080);
  });

  it("rejects out of range", () => {
    assert.throws(() => parsePort(0));
    assert.throws(() => parsePort(65536));
    assert.throws(() => parsePortArg("nope"));
  });

  it("parses ipv4 and ipv6 endpoints", () => {
    assert.deepEqual(parseEndpoint("127.0.0.1:3000"), {
      address: "127.0.0.1",
      port: 3000,
      family: "ipv4",
      bindAddress: "127.0.0.1",
    });
    assert.equal(formatEndpoint("::1", 3000), "[::1]:3000");
    assert.equal(parseEndpoint("[::]:80").family, "ipv6");
  });

  it("classifies bind scope", () => {
    assert.equal(bindScope("127.0.0.1"), "loopback");
    assert.equal(bindScope("0.0.0.0"), "unspecified");
    assert.equal(bindScope("::"), "unspecified");
    assert.equal(bindScope("::1"), "loopback");
    assert.equal(bindScope("10.0.0.5"), "private");
    assert.equal(bindScope("8.8.8.8"), "public");
  });

  it("decodes linux /proc hex addresses", () => {
    assert.equal(parseHexIPv4("0100007F"), "127.0.0.1");
    assert.equal(parseHexIPv4("00000000"), "0.0.0.0");
    assert.equal(parseHexIPv6("00000000000000000000000001000000"), "::1");
  });

  it("property: parsePort ∘ String is identity for valid ports", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 65535 }), (port) => {
        assert.equal(parsePort(String(port)), port);
        assert.equal(parsePortArg(`:${port}`), port);
      }),
    );
  });

  it("property: ipv4 endpoints round-trip", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 1, max: 65535 }),
        ),
        ([a, b, c, d, port]) => {
          const address = `${a}.${b}.${c}.${d}`;
          const parsed = parseEndpoint(`${address}:${port}`);
          assert.equal(parsed.address, address);
          assert.equal(parsed.port, port);
          assert.equal(parsed.family, "ipv4");
        },
      ),
    );
  });
});
