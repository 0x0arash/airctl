import type { HealthState, ProcessId, Port, ServiceClassification } from "./types.js";

export type DomainEvent =
  | { type: "ProcessStarted"; at: string; pid: ProcessId; executable?: string }
  | { type: "ProcessExited"; at: string; pid: ProcessId; executable?: string }
  | { type: "SocketOpened"; at: string; port: Port; address: string; pid?: ProcessId }
  | { type: "SocketClosed"; at: string; port: Port; address: string; pid?: ProcessId }
  | { type: "ProjectDiscovered"; at: string; projectId: string; name: string; root: string }
  | { type: "ProjectChanged"; at: string; projectId: string; name: string }
  | { type: "ServiceDiscovered"; at: string; serviceId: string; name: string; port?: Port }
  | {
      type: "ServiceUpdated";
      at: string;
      serviceId: string;
      name: string;
      classification?: ServiceClassification;
    }
  | { type: "HealthChanged"; at: string; serviceId: string; from: HealthState; to: HealthState }
  | { type: "WarningRaised"; at: string; warningId: string; title: string }
  | { type: "WarningResolved"; at: string; warningId: string; title: string };

export function describeEvent(event: DomainEvent): string {
  switch (event.type) {
    case "ProcessStarted":
      return `started ${event.executable ?? "process"} pid ${event.pid}`;
    case "ProcessExited":
      return `exited ${event.executable ?? "process"} pid ${event.pid}`;
    case "SocketOpened":
      return `listening ${event.address}:${event.port}`;
    case "SocketClosed":
      return `closed ${event.address}:${event.port}`;
    case "ProjectDiscovered":
      return `discovered project ${event.name}`;
    case "ProjectChanged":
      return `updated project ${event.name}`;
    case "ServiceDiscovered":
      return event.port === undefined
        ? `discovered ${event.name}`
        : `discovered ${event.name} :${event.port}`;
    case "ServiceUpdated":
      return `updated ${event.name}`;
    case "HealthChanged":
      return `${event.serviceId} ${event.from} → ${event.to}`;
    case "WarningRaised":
      return event.title;
    case "WarningResolved":
      return `resolved: ${event.title}`;
  }
}
