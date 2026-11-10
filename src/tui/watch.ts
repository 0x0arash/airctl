import { emitKeypressEvents, type Key } from "node:readline";
import type { Snapshot, ProcessInfo } from "../domain/types.js";
import type { AppContext } from "../engine/app.js";
import { formatStatus } from "../cli/format.js";
import { serviceRows, sameProcess, terminalText } from "./model.js";

export async function runWatchTui(
  app: AppContext,
  options: { all: boolean; project?: string },
): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    const snapshot = await app.engine.scan({ fast: true });
    process.stdout.write(
      `${formatStatus(snapshot, { env: app.runtime.env, tty: false, ...options, quiet: false, nowMs: app.runtime.clock.nowMs() })}\n`,
    );
    return;
  }
  let snapshot: Snapshot | undefined;
  let query = "";
  let searching = false;
  let selected = 0;
  let selectedId: string | undefined;
  let project = options.project;
  let all = options.all;
  let details = false;
  let busy = false;
  let fullMode = false;
  let active = true;
  let message = "Discovering local services…";
  let confirmation: ProcessInfo | undefined;
  const rows = () => (snapshot ? serviceRows(snapshot, { all, project, query }) : []);
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const quit = (): void => {
    active = false;
    finish();
  };
  const cell = (value: string, width: number): string =>
    value.length >= width ? value.slice(0, width - 2) + "… " : value.padEnd(width);
  const render = (): void => {
    if (!active) return;
    const width = Math.max(20, process.stdout.columns || 80);
    const height = Math.max(8, process.stdout.rows || 24);
    const list = rows();
    if (selectedId) {
      const index = list.findIndex((row) => row.service.id === selectedId);
      if (index >= 0) selected = index;
    }
    selected = Math.max(0, Math.min(selected, list.length - 1));
    selectedId = list[selected]?.service.id;
    const row = list[selected];
    const body: string[] = [];
    body.push(
      `AIRCTL  ${busy ? "⟳ working" : `${list.length} services`}  project: ${project ?? "all"}${all ? " · system included" : ""}`,
    );
    body.push(
      `${searching ? "/ Search: " : "Filter: "}${query || (searching ? "" : "none")}  ${snapshot ? `scan ${snapshot.durationMs}ms` : ""}`,
    );
    body.push("   PORT       SERVICE              PROJECT             PID     STATE");
    const detailLines = details && row && height >= 16 ? 7 : 0;
    const capacity = Math.max(1, height - 6 - detailLines);
    const offset = Math.floor(selected / capacity) * capacity;
    for (const [index, item] of list.slice(offset, offset + capacity).entries()) {
      const prefix = offset + index === selected ? "> " : "  ";
      if (width < 70)
        body.push(
          `${prefix}:${item.ports.join(",") || "—"} ${item.service.name} · ${item.service.health}`,
        );
      else
        body.push(
          prefix +
            cell(item.ports.map((port) => `:${port}`).join(",") || "—", 11) +
            cell(item.service.name, 21) +
            cell(item.project, 20) +
            String(item.service.processId ?? "—").padEnd(8) +
            item.service.health,
        );
    }
    if (!list.length)
      body.push(
        snapshot
          ? "No matching services. / search · p project · a system services"
          : "Scanning… You can search or press q to quit.",
      );
    if (details && row && height >= 16) {
      const proc = snapshot?.processes.find((item) => item.pid === row.service.processId);
      body.push(
        "─".repeat(Math.min(width, 80)),
        `${row.service.name} · ${row.service.classification} (${row.service.evidenceKind})`,
        `Project: ${row.root ?? "unavailable"}`,
        `PID: ${proc?.pid ?? "unavailable"} · ${proc?.availability ?? "unknown"}`,
        `Command: ${proc?.command ?? "unavailable"}`,
        `Health: ${row.service.health}${row.service.health === "running" ? " (not probed; h runs health checks)" : ""}`,
        "s stop process (confirmation required)",
      );
    }
    body.push(
      confirmation
        ? `Stop ${confirmation.executable ?? "process"} (PID ${confirmation.pid})? y confirm · Esc cancel`
        : message,
    );
    body.push("↑↓/jk select · / search · p project · Enter details · s stop");
    body.push(`r refresh · h health ${fullMode ? "on" : "off"} · a system · Esc back · q quit`);
    process.stdout.write(
      "\x1b[H\x1b[2J" +
        body
          .slice(0, height)
          .map((line) => terminalText(line).slice(0, Math.max(1, width - 1)))
          .join("\n"),
    );
  };
  const refresh = async (full = fullMode): Promise<void> => {
    if (busy) return;
    busy = true;
    message = full ? "Checking health and Docker…" : "Refreshing…";
    render();
    try {
      snapshot = await app.engine.scan({ fast: !full });
      message = full
        ? "Health checks complete"
        : "Live inventory · running means health has not been probed";
    } catch (error) {
      message = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
      render();
    }
  };
  const stop = async (expected: ProcessInfo): Promise<void> => {
    busy = true;
    confirmation = undefined;
    message = `Stopping PID ${expected.pid}…`;
    render();
    try {
      const current = await app.engine.inspectPid(expected.pid);
      if (!sameProcess(expected, current))
        throw new Error("Process changed since selection. Refresh and select it again.");
      const result = await app.controller.stop({ pid: current.pid });
      message = result.stopped
        ? `Stopped PID ${current.pid}`
        : `PID ${current.pid} is still running after SIGTERM`;
      if (active) snapshot = await app.engine.scan({ fast: true });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
      render();
    }
  };
  const onKey = (text: string, key: Key): void => {
    if (key.ctrl && key.name === "c") {
      quit();
      return;
    }
    if (confirmation) {
      if (key.name === "escape" || text === "n") confirmation = undefined;
      else if (text === "y" && !busy) void stop(confirmation);
      render();
      return;
    }
    if (searching) {
      if (key.name === "escape" || key.name === "return") searching = false;
      else if (key.name === "backspace") query = query.slice(0, -1);
      else if (
        text &&
        !key.ctrl &&
        !key.meta &&
        [...text].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
      )
        query += text;
      selected = 0;
      selectedId = undefined;
      render();
      return;
    }
    const list = rows();
    if (text === "q") {
      quit();
      return;
    }
    if (key.name === "up" || text === "k") {
      selected--;
      selectedId = undefined;
    } else if (key.name === "down" || text === "j") {
      selected++;
      selectedId = undefined;
    } else if (text === "/") searching = true;
    else if (key.name === "return") details = !details;
    else if (key.name === "escape") {
      details = false;
      query = "";
    } else if (text === "a") {
      all = !all;
      selected = 0;
      selectedId = undefined;
    } else if (text === "p") {
      const names = [undefined, ...new Set(snapshot?.projects.map((item) => item.name) ?? [])];
      project = names[(names.indexOf(project) + 1) % names.length];
      selected = 0;
      selectedId = undefined;
    } else if (text === "r") void refresh();
    else if (text === "h" && !busy) {
      fullMode = !fullMode;
      app.engine.stopLoop();
      void refresh().then(() => {
        if (active) app.engine.startAdaptiveLoop({ fast: !fullMode }, false);
      });
    } else if (text === "s" && !busy) {
      const pid = list[selected]?.service.processId;
      confirmation = snapshot?.processes.find((item) => item.pid === pid);
      if (!confirmation) message = "No host process available to stop for this service.";
    }
    render();
  };
  const wasRaw = process.stdin.isRaw;
  const unsubscribe = app.engine.onChange((current) => {
    snapshot = current;
    render();
  });
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", onKey);
  process.stdout.on("resize", render);
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  try {
    render();
    void refresh().then(() => {
      if (active) app.engine.startAdaptiveLoop({ fast: true }, false);
    });
    await done;
  } finally {
    active = false;
    unsubscribe();
    app.engine.stopLoop();
    process.stdin.off("keypress", onKey);
    process.stdout.off("resize", render);
    process.off("SIGINT", quit);
    process.off("SIGTERM", quit);
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  }
}
