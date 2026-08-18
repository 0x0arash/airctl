import type { Runtime } from "../runtime/index.js";
import type { ListeningSocket } from "../domain/types.js";
import { listLinuxSockets } from "./linux.js";
import { listDarwinSockets } from "./darwin.js";
import { listWindowsSockets } from "./windows.js";

export interface SocketProvider {
  listListeningSockets(): Promise<ListeningSocket[]>;
}

export class PlatformSocketProvider implements SocketProvider {
  constructor(private readonly runtime: Runtime) {}

  async listListeningSockets(): Promise<ListeningSocket[]> {
    try {
      switch (this.runtime.platform) {
        case "linux":
          return await listLinuxSockets(this.runtime.fs);
        case "darwin":
          return await listDarwinSockets(this.runtime.commands);
        case "win32":
          return await listWindowsSockets(this.runtime.commands);
        default:
          return [];
      }
    } catch {
      return [];
    }
  }
}

export class StaticSocketProvider implements SocketProvider {
  constructor(private sockets: ListeningSocket[] = []) {}

  async listListeningSockets(): Promise<ListeningSocket[]> {
    return this.sockets;
  }

  set(sockets: ListeningSocket[]): void {
    this.sockets = sockets;
  }
}
