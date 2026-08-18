import { useEffect, useState } from "react";
import { api } from "../api/client";

export function Inspector({
  port,
  pid,
  onStop,
}: {
  port?: number;
  pid?: number;
  onStop: () => Promise<void> | void;
}) {
  const [data, setData] = useState<Record<string, unknown> | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        if (port !== undefined) setData(await api.explain(port));
        else if (pid !== undefined) setData(await api.inspect(pid));
        else setData(undefined);
        setError(undefined);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [port, pid]);

  const process = (data?.process ??
    (
      data as
        | { process?: { pid?: number; executable?: string; command?: string; cwd?: string } }
        | undefined
    )?.process) as
    | { pid?: number; executable?: string; command?: string; cwd?: string }
    | undefined;
  const stopPid = pid ?? process?.pid;

  return (
    <section>
      <h1>
        {port !== undefined ? `Port ${port}` : pid !== undefined ? `PID ${pid}` : "Inspector"}
      </h1>
      {error ? (
        <p className="bad" role="alert">
          {error}
        </p>
      ) : null}
      {!data ? <p className="muted">Select a port or process.</p> : null}
      {data ? (
        <article className="inspect">
          <pre className="mono">{JSON.stringify(data, null, 2)}</pre>
          {stopPid ? (
            <p>
              <button
                type="button"
                onClick={async () => {
                  const ok = window.confirm(
                    `Stop PID ${stopPid}? This sends a graceful termination request.`,
                  );
                  if (!ok) return;
                  const res = await api.stop(stopPid);
                  if (!res.ok) {
                    setError("Stop failed.");
                    return;
                  }
                  await onStop();
                }}
              >
                Stop process
              </button>
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
