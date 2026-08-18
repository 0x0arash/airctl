import type { Runtime } from "../runtime/index.js";
import type { ProcessId, ProcessInfo } from "../domain/types.js";
import { listLinuxProcesses, inspectLinuxProcess } from "./linux.js";
import { listDarwinProcesses } from "./darwin.js";
import { listWindowsProcesses } from "./windows.js";

export interface ProcessProvider {
  listProcesses(): Promise<ProcessInfo[]>;
  inspect(pid: ProcessId): Promise<ProcessInfo | undefined>;
}

export class PlatformProcessProvider implements ProcessProvider {
  constructor(private readonly runtime: Runtime) {}

  async listProcesses(): Promise<ProcessInfo[]> {
    try {
      switch (this.runtime.platform) {
        case "linux":
          return await listLinuxProcesses(this.runtime.fs);
        case "darwin":
          return await listDarwinProcesses(this.runtime.commands);
        case "win32":
          return await listWindowsProcesses(this.runtime.commands);
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  async inspect(pid: ProcessId): Promise<ProcessInfo | undefined> {
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    if (this.runtime.platform === "linux") {
      return inspectLinuxProcess(this.runtime.fs, pid);
    }
    const all = await this.listProcesses();
    return all.find((p) => p.pid === pid);
  }
}

export class StaticProcessProvider implements ProcessProvider {
  constructor(private processes: ProcessInfo[] = []) {}

  async listProcesses(): Promise<ProcessInfo[]> {
    return this.processes;
  }

  async inspect(pid: ProcessId): Promise<ProcessInfo | undefined> {
    return this.processes.find((p) => p.pid === pid);
  }

  set(processes: ProcessInfo[]): void {
    this.processes = processes;
  }
}
