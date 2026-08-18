import { useEffect, useState } from "react";
import { api } from "../api/client";

export function ActivityView() {
  const [events, setEvents] = useState<Array<{ id: string; at: string; message: string }>>([]);

  useEffect(() => {
    void api.status().then((status) => {
      const raw = (
        status as unknown as { events?: Array<{ id: string; at: string; message: string }> }
      ).events;
      setEvents(raw ?? []);
    });
  }, []);

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
