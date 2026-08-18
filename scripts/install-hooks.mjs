import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!existsSync(path.join(root, ".git"))) {
  process.exit(0);
}

const child = spawn("npx", ["lefthook", "install"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  windowsHide: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
