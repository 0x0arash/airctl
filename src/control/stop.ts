import { AirCtlError } from "../domain/errors.js";
import type { ProcessId, ProcessInfo } from "../domain/types.js";
import type { CommandRunner } from "../runtime/spawn.js";

export interface StopOptions {
  pid: ProcessId;
  force?: boolean;
  waitMs?: number;
}

export interface ProcessController {
  stop(options: StopOptions): Promise<{ stopped: boolean; signal: string }>;
}

export class PlatformProcessController implements ProcessController {
  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly inspect: (pid: ProcessId) => Promise<ProcessInfo | undefined>,
    private readonly commands: CommandRunner,
  ) {}

  async stop(options: StopOptions): Promise<{ stopped: boolean; signal: string }> {
    const pid = options.pid;
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new AirCtlError("INVALID_INPUT", `Invalid PID: ${pid}`);
    }
    if (pid === process.pid || pid === 1) {
      throw new AirCtlError("INVALID_INPUT", "Refusing to stop this process.");
    }
    const info = await this.inspect(pid);
    if (!info || info.availability === "gone") {
      throw new AirCtlError("PROCESS_NOT_FOUND", `Process ${pid} no longer exists.`);
    }

    if (this.platform === "win32") {
      return this.stopWindows(pid, options.force === true);
    }
    return this.stopUnix(pid, options.force === true, options.waitMs ?? 3000);
  }

  private async stopUnix(
    pid: number,
    force: boolean,
    waitMs: number,
  ): Promise<{ stopped: boolean; signal: string }> {
    const signal = force ? "SIGKILL" : "SIGTERM";
    try {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ESRCH") {
        throw new AirCtlError("PROCESS_NOT_FOUND", `Process ${pid} no longer exists.`);
      }
      if (err.code === "EPERM") {
        throw new AirCtlError("PERMISSION_DENIED", `Permission denied stopping process ${pid}.`);
      }
      throw new AirCtlError("INTERNAL_ERROR", `Failed to stop process ${pid}.`, { cause: error });
    }
    if (force) return { stopped: true, signal };
    const gone = await waitUntilGone(pid, waitMs);
    return { stopped: gone, signal };
  }

  private async stopWindows(
    pid: number,
    force: boolean,
  ): Promise<{ stopped: boolean; signal: string }> {
    const args = ["/PID", String(pid)];
    if (force) args.push("/F");
    const result = await this.commands.run("taskkill", args);
    if (result.code !== 0) {
      const text = `${result.stdout} ${result.stderr}`.toLowerCase();
      if (text.includes("not found") || text.includes("not running")) {
        throw new AirCtlError("PROCESS_NOT_FOUND", `Process ${pid} no longer exists.`);
      }
      if (text.includes("denied") || text.includes("access")) {
        throw new AirCtlError("PERMISSION_DENIED", `Permission denied stopping process ${pid}.`);
      }
      throw new AirCtlError("INTERNAL_ERROR", `Failed to stop process ${pid}.`);
    }
    return { stopped: true, signal: force ? "SIGKILL" : "SIGTERM" };
  }
}

async function waitUntilGone(pid: number, waitMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ESRCH") return true;
    }
    await delay(100);
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
