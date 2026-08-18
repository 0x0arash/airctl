import { spawn } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

export interface CommandRunner {
  run(file: string, args: string[], options?: RunOptions): Promise<CommandResult>;
}

export interface RunOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

export class NodeCommandRunner implements CommandRunner {
  async run(file: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;

    return await new Promise((resolve) => {
      const child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        shell: false,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutSize = 0;
      let stderrSize = 0;
      let timedOut = false;
      let settled = false;

      const finish = (code: number): void => {
        if (settled) return;
        settled = true;
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          code,
          timedOut,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 1000).unref();
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutSize += chunk.length;
        if (stdoutSize <= maxBuffer) stdoutChunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrSize += chunk.length;
        if (stderrSize <= maxBuffer) stderrChunks.push(chunk);
      });
      child.on("error", () => {
        clearTimeout(timer);
        finish(127);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(code ?? (timedOut ? 124 : 1));
      });
    });
  }
}

export class FakeCommandRunner implements CommandRunner {
  private handlers = new Map<string, CommandResult>();

  on(file: string, args: string[], result: CommandResult): void {
    this.handlers.set(key(file, args), result);
  }

  async run(file: string, args: string[]): Promise<CommandResult> {
    return (
      this.handlers.get(key(file, args)) ?? {
        stdout: "",
        stderr: `not mocked: ${file} ${args.join(" ")}`,
        code: 127,
        timedOut: false,
      }
    );
  }
}

function key(file: string, args: string[]): string {
  return `${file}\0${args.join("\0")}`;
}
