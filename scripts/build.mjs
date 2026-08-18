import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

async function run(file, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${file} ${args.join(" ")} exited ${code}`));
    });
  });
}

await rm(path.join(root, "dist"), { recursive: true, force: true });
const tsc = require.resolve("typescript/bin/tsc");
await run(process.execPath, [tsc, "-p", "tsconfig.json"]);

const webOut = path.join(root, "dist", "web");
await mkdir(path.join(webOut, "assets"), { recursive: true });
await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["web/src/main.tsx"],
  bundle: true,
  format: "esm",
  outfile: path.join(webOut, "assets", "main.js"),
  jsx: "automatic",
  minify: true,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

await writeFile(
  path.join(webOut, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>AirCtl</title>
    <link rel="stylesheet" href="./assets/main.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/main.js"></script>
  </body>
</html>
`,
);
