import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ActivityEvent, Snapshot } from "../domain/types.js";
import type { SnapshotStore } from "./store.js";

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

export function openSqliteStore(dbPath: string): SnapshotStore {
  const dir = path.dirname(dbPath);
  mkdirSync(dir, { recursive: true });
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDb;
  };
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      scanned_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_at ON events(at);
  `);
  return new SqliteSnapshotStore(db);
}

class SqliteSnapshotStore implements SnapshotStore {
  constructor(private readonly db: SqliteDb) {}

  async save(snapshot: Snapshot): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO snapshots(id, scanned_at, payload) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET scanned_at=excluded.scanned_at, payload=excluded.payload",
      )
      .run(snapshot.scannedAt, JSON.stringify(snapshot));
  }

  async load(): Promise<Snapshot | undefined> {
    const row = this.db.prepare("SELECT payload FROM snapshots WHERE id = 1").get() as
      | { payload: string }
      | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.payload) as Snapshot;
    } catch {
      return undefined;
    }
  }

  async appendEvents(events: ActivityEvent[], limit: number): Promise<ActivityEvent[]> {
    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO events(id, at, type, message) VALUES (?, ?, ?, ?)",
    );
    for (const event of events) {
      insert.run(event.id, event.at, event.type, event.message);
    }
    const safeLimit = Math.max(1, Math.min(10_000, Math.floor(limit)));
    this.db.exec(
      `DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY at DESC LIMIT ${safeLimit})`,
    );
    return this.loadEvents(safeLimit);
  }

  async loadEvents(limit: number): Promise<ActivityEvent[]> {
    const rows = this.db
      .prepare("SELECT id, at, type, message FROM events ORDER BY at DESC LIMIT ?")
      .all(limit) as ActivityEvent[];
    return rows.slice().reverse();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
