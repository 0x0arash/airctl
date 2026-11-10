import { buildSync } from "esbuild";
import { createRequire } from "node:module";

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
