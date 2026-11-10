import type { SnapshotExtras } from "../api/client";

export function ActivityView({ events }: { events: SnapshotExtras["events"] }) {
  return (
    <section>
      <h1>Activity</h1>
      {events.length === 0 ? (
        <p className="muted">
          No recent discovery changes. Activity appears after the first refresh cycle.
        </p>
      ) : null}
      <ol>
        {events.map((event) => (
          <li key={event.id} className="mono">
            {event.at} {event.message}
          </li>
        ))}
      </ol>
    </section>
  );
}
