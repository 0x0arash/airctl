import type { Clock } from "./clock.js";
import { SystemClock } from "./clock.js";
import type { EnvProvider } from "./env.js";
import { ProcessEnv } from "./env.js";
import type { FileSystemProvider } from "./fs.js";
import { NodeFileSystem } from "./fs.js";
import type { CommandRunner } from "./spawn.js";
import { NodeCommandRunner } from "./spawn.js";

export interface Runtime {
  clock: Clock;
  fs: FileSystemProvider;
  commands: CommandRunner;
  env: EnvProvider;
  platform: NodeJS.Platform;
  homedir(): string;
  tmpdir(): string;
}

export async function createNodeRuntime(): Promise<Runtime> {
  const os = await import("node:os");
  return {
    clock: new SystemClock(),
    fs: await NodeFileSystem.create(),
    commands: new NodeCommandRunner(),
    env: new ProcessEnv(),
    platform: process.platform,
    homedir: () => os.homedir(),
    tmpdir: () => os.tmpdir(),
  };
}
