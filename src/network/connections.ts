import type { EstablishedConnection, ListeningSocket, Port } from "../domain/types.js";
import { isLoopbackAddress, isUnspecifiedAddress } from "./parse.js";

export function connectionTargetsListener(
  connection: EstablishedConnection,
  socket: ListeningSocket,
): boolean {
  if (connection.protocol !== socket.protocol) return false;
  if (connection.remotePort !== socket.port) return false;
  if (connection.pid !== undefined && connection.pid === socket.pid) return false;
  return addressCanReach(connection.remoteAddress, socket.address);
}

export function addressCanReach(remoteAddress: string, listenAddress: string): boolean {
  const remote = stripMapped(remoteAddress);
  const listen = stripMapped(listenAddress);
  if (isUnspecifiedAddress(listen)) return isLoopbackAddress(remote) || remote === listen;
  if (isLoopbackAddress(listen)) return isLoopbackAddress(remote);
  return remote === listen;
}

export function isLocalhostConnection(connection: EstablishedConnection): boolean {
  return isLoopbackAddress(stripMapped(connection.remoteAddress));
}

export function listenerPortsOf(sockets: ListeningSocket[]): Set<Port> {
  return new Set(sockets.map((s) => s.port));
}

function stripMapped(address: string): string {
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return lower.slice("::ffff:".length);
  return address;
}
