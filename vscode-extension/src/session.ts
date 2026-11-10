import { execFile, type ChildProcessWithoutNullStreams } from "node:child_process";

interface SessionError extends Error {
  unsupported?: boolean;
  code?: string;
}
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** One parent-owned process; mutations are never replayed after a disconnect. */
export class DiscoverySession<T> {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private resolveReady?: () => void;
  private rejectReady?: (error: Error) => void;
  private pending = new Map<string, Pending>();
  private generation = 0;
  private nextId = 0;
  private disposed = false;
  private failed = false;
  private backoff = 500;
  private reconnect?: ReturnType<typeof setTimeout>;
  private startup?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private latest?: T;
  private scanError?: Error;
  private statusPending?: Promise<T>;

  constructor(
    private readonly options: {
      launch(): ChildProcessWithoutNullStreams;
      onSnapshot(value: T): void;
      onError(error: SessionError): void;
      validate(value: unknown): value is T;
      intervalMs: number;
      requestTimeoutMs?: number;
      retryMs?: number;
      shutdownTimeoutMs?: number;
    },
  ) {}

  start(): void {
    if (this.disposed || (this.child && !this.failed)) return;
    const generation = ++this.generation;
    this.failed = false;
    this.latest = undefined;
    this.scanError = undefined;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.ready.catch(() => {});
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.options.launch();
      this.child = child;
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let buffer = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8192);
    });
    child.stdout.on("data", (chunk: string) => {
      if (generation !== this.generation || this.disposed || this.failed) return;
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > 8 * 1024 * 1024) {
          this.fail(new Error("AirCtl sent an oversized session frame."));
          return;
        }
        if (!line.trim()) continue;
        try {
          this.frame(JSON.parse(line));
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error("Invalid AirCtl session frame."));
          return;
        }
        if (this.failed || this.disposed) return;
      }
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024)
        this.fail(new Error("AirCtl sent an oversized session frame."));
    });
    child.stdin.on("error", (error) => {
      if (generation === this.generation) this.fail(error);
    });
    child.on("error", (error) => {
      if (generation === this.generation) this.fail(error);
    });
    child.on("close", (code) => {
      if (generation !== this.generation) return;
      const error: SessionError = new Error(
        stderr.trim() || `AirCtl session exited (${code ?? "signal"}).`,
      );
      error.unsupported = code === 2 && /unknown (?:command|flag)/i.test(stderr);
      this.fail(error);
    });
    this.startup = setTimeout(
      () => this.fail(new Error("AirCtl session did not become ready.")),
      this.options.requestTimeoutMs ?? 30000,
    );
    this.startup.unref?.();
    void this.ready
      .then(async () => {
        if (generation !== this.generation || this.disposed) return;
        await this.request("configure", { intervalMs: this.options.intervalMs });
        await this.status();
      })
      .catch((error) => {
        if (generation === this.generation) this.fail(error);
      });
  }

  private frame(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid AirCtl session frame.");
    const frame = value as Record<string, unknown>;
    const errorPayload =
      frame.error && typeof frame.error === "object"
        ? (frame.error as Record<string, unknown>)
        : undefined;
    const message =
      typeof errorPayload?.message === "string" ? errorPayload.message : "AirCtl request failed.";
    const code = typeof errorPayload?.code === "string" ? errorPayload.code : undefined;
    if (frame.type === "ready") {
      if (frame.protocol !== 1)
        throw Object.assign(new Error("Unsupported AirCtl session protocol."), {
          unsupported: true,
        });
      if (this.startup) clearTimeout(this.startup);
      this.resolveReady?.();
      return;
    }
    if (!frame.type && errorPayload) {
      throw Object.assign(new Error(message), {
        code,
        unsupported: code === "INVALID_INPUT" && /unknown (?:command|flag)/i.test(message),
      });
    }
    if (frame.type === "snapshot") {
      if (!this.options.validate(frame.data)) throw new Error("Invalid AirCtl snapshot.");
      this.latest = frame.data;
      this.scanError = undefined;
      this.backoff = 500;
      if (this.watchdog) clearTimeout(this.watchdog);
      this.watchdog = setTimeout(
        () => this.fail(new Error("AirCtl stopped sending live updates.")),
        Math.min(
          2147483647,
          Math.max(30000, this.options.requestTimeoutMs ?? 30000, this.options.intervalMs * 3),
        ),
      );
      this.watchdog.unref?.();
      this.options.onSnapshot(frame.data);
      return;
    }
    if (frame.type === "error") {
      this.scanError = new Error(message);
      this.options.onError(this.scanError);
      return;
    }
    if (frame.type !== "response" || typeof frame.id !== "string")
      throw new Error("Invalid AirCtl session response.");
    const pending = this.pending.get(frame.id);
    if (!pending) return; // A late response to a timed-out request must not be reused.
    this.pending.delete(frame.id);
    clearTimeout(pending.timer);
    if (errorPayload) pending.reject(Object.assign(new Error(message), { code }));
    else pending.resolve(frame.result);
  }

  async request<R>(method: string, parameters: Record<string, unknown> = {}): Promise<R> {
    if (this.disposed) throw new Error("AirCtl session is disposed.");
    if (!this.ready) this.start();
    await this.ready;
    if (this.failed || !this.child) throw new Error("AirCtl is reconnecting; try again shortly.");
    const id = `${this.generation}:${++this.nextId}`;
    if (this.pending.size >= 32) throw new Error("Too many pending AirCtl requests.");
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.fail(
            new Error(
              `AirCtl ${method} request timed out. Its outcome is unknown; it was not retried.`,
            ),
          ),
        this.options.requestTimeoutMs ?? 30000,
      );
      timer.unref?.();
      this.pending.set(id, { resolve: (value) => resolve(value as R), reject, timer });
      this.child!.stdin.write(JSON.stringify({ ...parameters, id, method }) + "\n", (error) => {
        if (error) this.fail(error);
      });
    });
  }

  status(): Promise<T> {
    if (this.scanError) return Promise.reject(this.scanError);
    if (this.latest && !this.failed && !this.disposed) return Promise.resolve(this.latest);
    this.statusPending ??= this.request<T>("status").finally(() => {
      this.statusPending = undefined;
    });
    return this.statusPending;
  }

  private stopChild(): void {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    // EOF reaches the Node process even through a Windows command shim.
    child.stdin.end();
    const kill = setTimeout(() => {
      if (child.exitCode !== null) return;
      if (process.platform === "win32" && child.pid) {
        // Kill only our owned shim/scanner tree, never a discovered service.
        execFile(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true },
          () => {},
        );
      } else child.kill("SIGKILL");
    }, this.options.shutdownTimeoutMs ?? 5000);
    kill.unref?.();
    child.once("close", () => clearTimeout(kill));
  }

  private fail(error: SessionError): void {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.latest = undefined;
    this.statusPending = undefined;
    if (this.startup) clearTimeout(this.startup);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.rejectReady?.(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.stopChild();
    this.options.onError(error);
    if (!error.unsupported && !this.disposed) {
      this.reconnect = setTimeout(() => this.start(), this.options.retryMs ?? this.backoff);
      this.reconnect.unref?.();
      this.backoff = Math.min(this.backoff * 2, 30000);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.startup) clearTimeout(this.startup);
    if (this.watchdog) clearTimeout(this.watchdog);
    const error = new Error("AirCtl session closed.");
    this.rejectReady?.(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.latest = undefined;
    this.stopChild();
  }
}
