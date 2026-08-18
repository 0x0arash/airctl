import type { ActivityEvent, Snapshot } from "../domain/types.js";

export interface SnapshotStore {
  save(snapshot: Snapshot): Promise<void>;
  load(): Promise<Snapshot | undefined>;
  appendEvents(events: ActivityEvent[], limit: number): Promise<ActivityEvent[]>;
  loadEvents(limit: number): Promise<ActivityEvent[]>;
  close(): Promise<void>;
}

export class MemorySnapshotStore implements SnapshotStore {
  private snapshot: Snapshot | undefined;
  private events: ActivityEvent[] = [];

  async save(snapshot: Snapshot): Promise<void> {
    this.snapshot = snapshot;
  }

  async load(): Promise<Snapshot | undefined> {
    return this.snapshot;
  }

  async appendEvents(events: ActivityEvent[], limit: number): Promise<ActivityEvent[]> {
    this.events = [...this.events, ...events].slice(-limit);
    return this.events;
  }

  async loadEvents(limit: number): Promise<ActivityEvent[]> {
    return this.events.slice(-limit);
  }

  async close(): Promise<void> {}
}

export async function createStore(dbPath: string): Promise<SnapshotStore> {
  try {
    const sqlite = await import("./sqlite.js");
    return sqlite.openSqliteStore(dbPath);
  } catch {
    return new MemorySnapshotStore();
  }
}
