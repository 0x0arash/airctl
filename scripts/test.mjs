import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tsx = require.resolve("tsx/cli");

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full)));
    else if (entry.name.endsWith(".test.ts")) files.push(full);
  }
  return files;
}

const files = await collect(path.join(root, "test"));
if (files.length === 0) {
  console.error("No tests found.");
  process.exit(1);
}

const child = spawn(process.execPath, [tsx, "--test", ...files], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
child.on("close", (code) => process.exit(code ?? 1));
