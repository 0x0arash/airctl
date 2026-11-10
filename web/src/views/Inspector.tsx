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
  const target = port !== undefined ? `port:${port}` : `pid:${pid}`;
  const [result, setResult] = useState<{ target: string; data: Record<string, unknown> }>();
  const data = result?.target === target ? result.data : undefined;
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const next =
          port !== undefined
            ? await api.explain(port)
            : pid !== undefined
              ? await api.inspect(pid)
              : undefined;
        if (cancelled) return;
        setResult(next ? { target, data: next } : undefined);
        setError(undefined);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [port, pid, target]);

  const process = (data?.process ??
    (
      data as
        | { process?: { pid?: number; executable?: string; command?: string; cwd?: string } }
        | undefined
    )?.process) as
    | { pid?: number; executable?: string; command?: string; cwd?: string }
    | undefined;
  const stopPid = data ? process?.pid : undefined;

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
                  try {
                    const res = await api.stop(stopPid);
                    if (!res.ok) {
                      setError("Stop failed.");
                      return;
                    }
                    const stopResult = (await res.json()) as { stopped?: boolean };
                    if (stopResult.stopped !== true) {
                      setError(`PID ${stopPid} is still running after the termination request.`);
                      return;
                    }
                    setResult(undefined);
                    await api.refresh();
                    await onStop();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
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
