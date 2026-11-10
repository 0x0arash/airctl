import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { htmlFallback } from "../src/server/http.js";
import type { ServerResponse } from "node:http";
import { redactCommand } from "../src/domain/redact.js";

export function loadBundled(entry: string, mocks: Record<string, unknown>) {
  const code = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    packages: "external",
  }).outputFiles[0]!.text;
  const module = { exports: {} as Record<string, (...args: any[]) => any> };
  const require = createRequire(import.meta.url);
  new Function("require", "module", "exports", "__dirname", code)(
    (name: string) => mocks[name] ?? require(name),
    module,
    module.exports,
    "/installed-extension/dist",
  );
  return module.exports;
}

describe("credential redaction", () => {
  it("redacts every credential even when another redaction has already matched", () => {
    for (const command of [
      "API_KEY=CANARY_ONE node app.js --password CANARY_TWO",
      "node app.js postgres://user:CANARY_ONE@localhost/db --token CANARY_TWO",
      'node app.js --password "CANARY_ONE CANARY_TWO"',
      "node app.js --token='CANARY_ONE CANARY_TWO'",
      'TOKEN="CANARY_ONE CANARY_TWO" node app.js --auth CANARY_THREE',
      'node app.js --authorization "Bearer CANARY_ONE" --password CANARY_TWO',
    ])
      assert.doesNotMatch(redactCommand(command)!, /CANARY/);
  });
});

describe("extension executable selection", () => {
  it("does not execute a workspace dist/cli.js", async () => {
    let selected: string[] = [];
    const extension = loadBundled("vscode-extension/src/airctl.ts", {
      vscode: {
        workspace: {
          getConfiguration: () => ({ get: () => "" }),
          workspaceFolders: [{ uri: { fsPath: "/unrelated-project" } }],
        },
      },
      "node:fs": { existsSync: () => true, readFileSync: () => '{"name":"unrelated-project"}' },
      "node:child_process": {
        execFile: (cmd: string, args: string[], _opts: unknown, cb: Function) => {
          selected = [cmd, ...args];
          cb(null, "{}", "");
        },
      },
    });
    await extension.getStatus!();
    assert.equal(selected[0], process.platform === "win32" ? "airctl.cmd" : "airctl");
    assert.ok(!selected.some((arg) => arg.includes("dist/cli.js")));
  });
});

describe("inspector request ordering", () => {
  it("hides the old target and ignores responses that finish after selection changes", async () => {
    const state: unknown[] = [];
    let cursor = 0;
    let effect: (() => () => void) | undefined;
    const pending = new Map<number, (data: unknown) => void>();
    const inspector = loadBundled("web/src/views/Inspector.tsx", {
      react: {
        useState: () => {
          const index = cursor++;
          return [
            state[index],
            (value: unknown) => {
              state[index] = value;
            },
          ];
        },
        useEffect: (fn: () => () => void) => {
          effect = fn;
        },
      },
      "react/jsx-runtime": {
        jsx: (type: unknown, props: unknown) => ({ type, props }),
        jsxs: (type: unknown, props: unknown) => ({ type, props }),
      },
      // The API module is bundled; intercept its fetch instead below.
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string) =>
      new Promise((resolve) => {
        pending.set(Number(url.split("/").at(-1)), (data) =>
          resolve({ ok: true, json: async () => data } as Response),
        );
      })) as typeof fetch;
    const render = (port: number) => {
      cursor = 0;
      return inspector.Inspector!({ port, onStop() {} });
    };
    try {
      render(3000);
      const cleanup = effect!();
      cleanup();
      render(4000);
      effect!();
      pending.get(4000)!({ process: { pid: 40 } });
      await new Promise((resolve) => setImmediate(resolve));
      pending.get(3000)!({ process: { pid: 30 } });
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(state[0], { target: "port:4000", data: { process: { pid: 40 } } });
      assert.doesNotMatch(JSON.stringify(render(5000)), /"pid":40/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("fallback DOM safety", () => {
  it("renders attacker-controlled names as text", async () => {
    let html = "";
    htmlFallback(
      {
        writeHead() {},
        end(value: string) {
          html = value;
        },
      } as unknown as ServerResponse,
      "session-token",
    );
    const values: string[] = [];
    const node = (): any => ({
      set textContent(value: string) {
        values.push(value);
      },
      append() {},
      replaceChildren() {},
      createTHead: node,
      createTBody: node,
      insertRow: node,
      insertCell: node,
    });
    const payload = '<img src=x onerror="alert(1)">';
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    runInNewContext(script, {
      document: {
        querySelector: () => ({ content: "session-token" }),
        getElementById: node,
        createElement: node,
      },
      fetch: async () => ({
        json: async () => ({
          summary: { services: 1 },
          services: [
            { name: payload, ports: [3000], health: "running", classification: "unknown" },
          ],
        }),
      }),
      EventSource: class {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(values.includes(payload));
    assert.doesNotMatch(script, /innerHTML/);
  });
});
