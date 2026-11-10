import type { Readable, Writable } from "node:stream";
import type { AppContext } from "../engine/app.js";
import { snapshotToJson } from "../cli/format.js";
import { AirCtlError, toErrorPayload } from "../domain/errors.js";

export const SESSION_PROTOCOL = 1;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_PENDING = 32;

/** Private, parent-owned NDJSON session. EOF shuts it down; no network listener. */
export async function runSession(
  app: AppContext,
  options: {
    input: Readable;
    output: Writable;
    fast: boolean;
    intervalMs?: number;
  },
): Promise<void> {
  const { input, output } = options;
  let interval = options.intervalMs ?? 10_000;
  let closed = false;
  const shutdown = new AbortController();
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingScan: Promise<unknown> | undefined;
  let latestStatus: unknown;
  const requests = new Set<string>();
  const tasks = new Set<Promise<void>>();
  let writes = Promise.resolve();
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const close = (): void => {
    closed = true;
    shutdown.abort();
    if (timer) clearTimeout(timer);
    finish();
  };
  const send = (frame: unknown): Promise<void> => {
    if (closed) return Promise.resolve();
    const line = JSON.stringify(frame) + "\n";
    writes = writes.then(
      () =>
        new Promise<void>((resolve, reject) => {
          if (closed || output.destroyed) {
            resolve();
            return;
          }
          const cancelled = (): void => resolve();
          shutdown.signal.addEventListener("abort", cancelled, { once: true });
          const complete = (error?: Error | null): void => {
            shutdown.signal.removeEventListener("abort", cancelled);
            if (error) reject(error);
            else resolve();
          };
          try {
            output.write(line, complete);
          } catch (error) {
            complete(error instanceof Error ? error : new Error(String(error)));
          }
        }),
    );
    // A disconnected reader must never leave the session alive or reject unhandled.
    void writes.catch(close);
    return writes;
  };
  const scan = (): Promise<unknown> => {
    if (pendingScan) return pendingScan;
    if (timer) clearTimeout(timer);
    pendingScan = app.engine
      .scan({ fast: options.fast })
      .then(async (snapshot) => {
        const data = snapshotToJson(snapshot, false);
        latestStatus = data;
        await send({ type: "snapshot", data });
        return data;
      })
      .finally(() => {
        pendingScan = undefined;
        if (!closed)
          timer = setTimeout(() => {
            void scan().catch(reportScanError);
          }, interval);
      });
    return pendingScan;
  };
  const reportScanError = (error: unknown): void => {
    void send({ type: "error", ...toErrorPayload(error) }).catch(close);
  };
  const dispatch = async (request: Record<string, unknown>): Promise<unknown> => {
    if (closed) throw new AirCtlError("DEPENDENCY_UNAVAILABLE", "Session is closing.");
    switch (request.method) {
      case "status": {
        return latestStatus ?? scan();
      }
      case "refresh":
        return scan();
      case "configure": {
        if (
          !Number.isSafeInteger(request.intervalMs) ||
          Number(request.intervalMs) < 1000 ||
          Number(request.intervalMs) > 2147483647
        ) {
          throw new AirCtlError(
            "INVALID_INPUT",
            "intervalMs must be an integer between 1000 and 2147483647.",
          );
        }
        interval = Number(request.intervalMs);
        if (timer) {
          clearTimeout(timer);
          timer = setTimeout(() => {
            void scan().catch(reportScanError);
          }, interval);
        }
        return { intervalMs: interval };
      }
      case "explain": {
        if (typeof request.port !== "number" && typeof request.port !== "string")
          throw new AirCtlError("INVALID_INPUT", "A port is required.");
        return app.engine.explainPort(request.port, { fresh: true });
      }
      case "inspect": {
        if (!Number.isSafeInteger(request.pid))
          throw new AirCtlError("INVALID_INPUT", "A PID is required.");
        return app.engine.inspectPid(Number(request.pid));
      }
      case "stop": {
        if (request.confirm !== true)
          throw new AirCtlError("CONFIRMATION_REQUIRED", "A stop request requires confirm: true.");
        if (!Number.isSafeInteger(request.pid) || Number(request.pid) <= 0)
          throw new AirCtlError("INVALID_INPUT", "A positive PID is required.");
        const result = await app.controller.stop({ pid: Number(request.pid) });
        return { stopped: [{ pid: Number(request.pid), ...result }] };
      }
      default:
        throw new AirCtlError("INVALID_INPUT", "Unknown session method.");
    }
  };
  const accept = (line: string): void => {
    if (closed || !line.trim()) return;
    let request: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        throw new Error("Expected object");
      request = parsed as Record<string, unknown>;
    } catch {
      void send({
        type: "error",
        error: { code: "INVALID_INPUT", message: "Invalid session JSON." },
      }).catch(close);
      return;
    }
    const id = request.id;
    if (typeof id !== "string" || id.length < 1 || id.length > 128 || requests.has(id)) {
      void send({
        type: "error",
        error: {
          code: "INVALID_INPUT",
          message: "Request ID must be unique and 1–128 characters.",
        },
      }).catch(close);
      return;
    }
    if (requests.size >= MAX_PENDING) {
      void send({
        type: "response",
        id,
        error: { code: "INVALID_INPUT", message: "Too many pending session requests." },
      }).catch(close);
      return;
    }
    requests.add(id);
    const task = (async () => {
      try {
        const result = await dispatch(request);
        await send({ type: "response", id, result });
        // Never replay a mutation. Refresh only after its response has been sent.
        if (request.method === "stop" && !closed) void scan().catch(reportScanError);
      } catch (error) {
        await send({ type: "response", id, ...toErrorPayload(error) });
      } finally {
        requests.delete(id);
      }
    })();
    tasks.add(task);
    void task.catch(close).finally(() => tasks.delete(task));
  };
  const onData = (chunk: string): void => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      if (closed) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) {
        close();
        return;
      }
      accept(line);
    }
    if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES) close();
  };
  input.setEncoding("utf8");
  input.on("data", onData);
  input.once("end", close);
  input.once("error", close);
  output.once("error", close);
  output.once("close", close);
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
  try {
    await send({ type: "ready", protocol: SESSION_PROTOCOL });
    if (input.readableEnded || input.destroyed) close();
    else if (!closed) void scan().catch(reportScanError);
    await done;
  } finally {
    close();
    input.pause();
    input.off("data", onData);
    input.off("end", close);
    input.off("error", close);
    output.off("error", close);
    output.off("close", close);
    process.off("SIGTERM", close);
    process.off("SIGINT", close);
    await Promise.allSettled([...tasks, ...(pendingScan ? [pendingScan] : []), writes]);
  }
}
