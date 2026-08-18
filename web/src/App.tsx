import { useEffect, useMemo, useState } from "react";
import { api, type GraphPayload, type StatusPayload } from "./api/client";
import { Overview } from "./views/Overview";
import { ServicesView } from "./views/Services";
import { ProjectsView } from "./views/Projects";
import { GraphView } from "./views/Graph";
import { WarningsView } from "./views/Warnings";
import { ActivityView } from "./views/Activity";
import { Inspector } from "./views/Inspector";

type View = "overview" | "services" | "projects" | "graph" | "warnings" | "activity" | "inspect";

const NAV: Array<{ id: View; label: string; shortcut: string }> = [
  { id: "overview", label: "Overview", shortcut: "1" },
  { id: "services", label: "Services", shortcut: "2" },
  { id: "projects", label: "Projects", shortcut: "3" },
  { id: "graph", label: "Graph", shortcut: "4" },
  { id: "warnings", label: "Warnings", shortcut: "5" },
  { id: "activity", label: "Activity", shortcut: "6" },
];

export function App() {
  const [view, setView] = useState<View>("overview");
  const [status, setStatus] = useState<StatusPayload | undefined>();
  const [graph, setGraph] = useState<GraphPayload | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [selectedPort, setSelectedPort] = useState<number | undefined>();
  const [selectedPid, setSelectedPid] = useState<number | undefined>();

  const load = async (): Promise<void> => {
    try {
      const [nextStatus, nextGraph] = await Promise.all([api.status(), api.graph()]);
      setStatus(nextStatus);
      setGraph(nextGraph);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void load();
    return api.subscribe(() => {
      void load();
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return;
      const item = NAV.find((n) => n.shortcut === event.key);
      if (item) setView(item.id);
      if (event.key === "r") void api.refresh().then(load);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const inspect = useMemo(
    () => ({
      onPort: (port: number) => {
        setSelectedPort(port);
        setSelectedPid(undefined);
        setView("inspect");
      },
      onPid: (pid: number) => {
        setSelectedPid(pid);
        setSelectedPort(undefined);
        setView("inspect");
      },
    }),
    [],
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <p className="brand">AirCtl</p>
        <p className="tagline">Local development control tower</p>
        <nav aria-label="Primary">
          {NAV.map((item) => (
            <a
              key={item.id}
              className={`nav ${view === item.id ? "active" : ""}`}
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                setView(item.id);
              }}
            >
              {item.label} <kbd>{item.shortcut}</kbd>
            </a>
          ))}
        </nav>
        <p className="privacy">
          AirCtl does not send your process, project, or network data anywhere.
        </p>
      </aside>
      <main>
        <div className="toolbar">
          <button type="button" onClick={() => void api.refresh().then(load)}>
            Refresh
          </button>
          {status ? <span className="muted">scanned {status.durationMs}ms</span> : null}
          {error ? (
            <span className="bad" role="alert">
              {error}
            </span>
          ) : null}
        </div>
        {status && view === "overview" ? (
          <Overview status={status} onPort={inspect.onPort} />
        ) : null}
        {status && view === "services" ? (
          <ServicesView status={status} onPort={inspect.onPort} onPid={inspect.onPid} />
        ) : null}
        {status && view === "projects" ? <ProjectsView status={status} /> : null}
        {graph && view === "graph" ? <GraphView graph={graph} /> : null}
        {status && view === "warnings" ? <WarningsView status={status} /> : null}
        {status && view === "activity" ? <ActivityView /> : null}
        {view === "inspect" ? (
          <Inspector port={selectedPort} pid={selectedPid} onStop={load} />
        ) : null}
      </main>
    </div>
  );
}
