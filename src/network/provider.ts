import type { Runtime } from "../runtime/index.js";
import type { EstablishedConnection, ListeningSocket, ProcessInfo } from "../domain/types.js";
import { listLinuxNetwork } from "./linux.js";
import { listDarwinNetwork } from "./darwin.js";
import { listWindowsNetwork } from "./windows.js";

export interface NetworkDiscovery {
  listening: ListeningSocket[];
  connections: EstablishedConnection[];
}

export interface SocketProvider {
  discover(processes?: ProcessInfo[]): Promise<NetworkDiscovery>;
  listListeningSockets(): Promise<ListeningSocket[]>;
}

export class PlatformSocketProvider implements SocketProvider {
  constructor(private readonly runtime: Runtime) {}

  async discover(processes: ProcessInfo[] = []): Promise<NetworkDiscovery> {
    try {
      switch (this.runtime.platform) {
        case "linux":
          return await listLinuxNetwork(this.runtime.fs);
        case "darwin":
          return await listDarwinNetwork(this.runtime.commands);
        case "win32":
          return await listWindowsNetwork(this.runtime.commands, processes);
        default:
          return { listening: [], connections: [] };
      }
    } catch {
      return { listening: [], connections: [] };
    }
  }

  async listListeningSockets(): Promise<ListeningSocket[]> {
    return (await this.discover()).listening;
  }
}

export class StaticSocketProvider implements SocketProvider {
  constructor(
    private sockets: ListeningSocket[] = [],
    private connections: EstablishedConnection[] = [],
  ) {}

  async discover(): Promise<NetworkDiscovery> {
    return { listening: this.sockets, connections: this.connections };
  }

  async listListeningSockets(): Promise<ListeningSocket[]> {
    return this.sockets;
  }

  set(sockets: ListeningSocket[], connections: EstablishedConnection[] = []): void {
    this.sockets = sockets;
    this.connections = connections;
  }
}
