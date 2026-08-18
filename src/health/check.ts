import { connect } from "node:net";
import { USER_AGENT } from "../version.js";
import type { HealthState, ListeningSocket, Service } from "../domain/types.js";
import { formatEndpoint } from "../network/parse.js";

export interface HealthChecker {
  check(service: Service, sockets: ListeningSocket[]): Promise<HealthState>;
}

export interface HealthOptions {
  enabled: boolean;
  tcpTimeoutMs: number;
  httpTimeoutMs: number;
  userAgent: string;
}

export const defaultHealthOptions: HealthOptions = {
  enabled: true,
  tcpTimeoutMs: 400,
  httpTimeoutMs: 1200,
  userAgent: USER_AGENT,
};

export class ConservativeHealthChecker implements HealthChecker {
  constructor(private readonly options: HealthOptions = defaultHealthOptions) {}

  async check(service: Service, sockets: ListeningSocket[]): Promise<HealthState> {
    if (!this.options.enabled) return "running";
    if (service.classification === "system-service") return "running";
    const tcpSocket = pickProbeSocket(sockets);
    if (!tcpSocket) return "unknown";

    const tcpOk = await tcpConnect(tcpSocket.address, tcpSocket.port, this.options.tcpTimeoutMs);
    if (!tcpOk) return "unhealthy";

    if (shouldHttpProbe(service)) {
      const http = await httpGet(tcpSocket, this.options);
      if (http === "healthy" || http === "unhealthy") return http;
    }
    return "healthy";
  }
}

export function pickProbeSocket(sockets: ListeningSocket[]): ListeningSocket | undefined {
  const loopback = sockets.find((s) => s.scope === "loopback" && s.protocol === "tcp");
  if (loopback) return loopback;
  return sockets.find((s) => s.protocol === "tcp");
}

export function shouldHttpProbe(service: Service): boolean {
  return service.classification === "development-server" || service.classification === "proxy";
}

export function tcpConnect(address: string, port: number, timeoutMs: number): Promise<boolean> {
  const host = address === "0.0.0.0" ? "127.0.0.1" : address === "::" ? "::1" : address;
  return new Promise((resolve) => {
    const socket = connect({ host, port, family: host.includes(":") ? 6 : 4 });
    const done = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export async function httpGet(
  socket: ListeningSocket,
  options: HealthOptions,
): Promise<HealthState | "skip"> {
  const host =
    socket.address === "0.0.0.0" ? "127.0.0.1" : socket.address === "::" ? "[::1]" : socket.address;
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const url = `http://${urlHost}:${socket.port}/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.httpTimeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": options.userAgent, accept: "text/html,application/json,*/*" },
    });
    if (res.status >= 200 && res.status < 400) return "healthy";
    if (res.status === 401 || res.status === 403 || res.status === 404) return "healthy";
    if (res.status >= 500) return "unhealthy";
    return "healthy";
  } catch {
    return "skip";
  } finally {
    clearTimeout(timer);
  }
}

export function formatProbeTarget(socket: ListeningSocket): string {
  return formatEndpoint(socket.address, socket.port);
}
