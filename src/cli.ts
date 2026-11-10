#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { AirCtlError, isAirCtlError, toErrorPayload } from "./domain/errors.js";
import { VERSION } from "./version.js";
import { createApp, type AppContext } from "./engine/app.js";
import { parseArgv, helpText } from "./cli/parse.js";
import {
  formatGraph,
  formatInspect,
  formatProjects,
  formatServices,
  formatStatus,
  snapshotToJson,
} from "./cli/format.js";
import { createPalette } from "./cli/color.js";
import { formatExplanation } from "./engine/explain.js";
import { formatDoctor, runDoctor } from "./engine/doctor.js";
import { formatConfig } from "./config/load.js";
import { runWatchTui } from "./tui/watch.js";
import { startServer } from "./server/http.js";
import { completionScript } from "./cli/complete.js";
import { runSession } from "./session/server.js";
import { resolveStopTargets } from "./control/targets.js";

suppressSqliteExperimentalWarning();

export async function runCli(
  argv: string[],
  io = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    return handleError(error, argv.includes("--json"), io);
  }

  if (parsed.flags.help || parsed.command === "help") {
    io.stdout.write(`${helpText()}\n`);
    return 0;
  }
  if (parsed.flags.version || parsed.command === "version") {
    io.stdout.write(
      `${parsed.flags.json ? JSON.stringify({ name: "airctl", version: VERSION }) : `airctl ${VERSION}`}\n`,
    );
    return 0;
  }
  if (parsed.command === "complete") {
    io.stdout.write(completionScript(parsed.args[0] ?? "bash"));
    return 0;
  }

  let app: AppContext | undefined;
  try {
    app = await createApp({
      verbose: parsed.flags.verbose,
      configPath: parsed.flags.config,
      json: parsed.flags.json,
    });
    return await dispatch(app, parsed.command, parsed.args, parsed.flags, io);
  } catch (error) {
    return handleError(error, parsed.flags.json, io);
  } finally {
    await app?.engine.close();
  }
}

async function dispatch(
  app: AppContext,
  command: string,
  args: string[],
  flags: ReturnType<typeof parseArgv>["flags"],
  io: { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream },
): Promise<number> {
  const json = flags.json;
  const tty = Boolean(io.stdout.isTTY);
  const palette = createPalette(app.runtime.env, tty);

  if (command === "session") {
    await runSession(app, { input: process.stdin, output: io.stdout, fast: flags.fast });
    return 0;
  }

  if (command === "config") {
    const payload = { path: app.configPath ?? null, config: app.config };
    io.stdout.write(
      json ? `${JSON.stringify(payload, null, 2)}\n` : `${formatConfig(app.config)}\n`,
    );
    return 0;
  }

  if (command === "ui") {
    const { url } = await startServer({
      app,
      openBrowser: app.config.ui.openBrowser && !flags.quiet,
    });
    io.stdout.write(`AirCtl UI on ${url}\n`);
    io.stdout.write("Data stays on this machine. Press Ctrl+C to stop.\n");
    await hang();
    return 0;
  }

  if (command === "tui" || (command === "status" && flags.watch)) {
    await runWatchTui(app, { all: flags.all, project: flags.project });
    return 0;
  }

  if (command === "stop") {
    return stopCommand(app, args, flags, io);
  }

  if (command === "open") {
    return openCommand(app, args, json, io);
  }

  if (command === "logs") {
    const events = await app.store.loadEvents(app.config.events.limit);
    io.stdout.write(
      json
        ? `${JSON.stringify(events)}\n`
        : events.length
          ? events.map((event) => `${event.at}  ${event.message}`).join("\n") + "\n"
          : "No activity yet.\n",
    );
    return 0;
  }

  if (command === "explain") {
    const port = flags.port ?? args[0];
    if (!port) throw new AirCtlError("INVALID_INPUT", "Usage: airctl explain <port>");
    const expl = await app.engine.explainPort(port);
    io.stdout.write(
      json
        ? `${JSON.stringify(expl)}\n`
        : `${formatExplanation(expl, app.runtime.clock.nowMs())}\n`,
    );
    return expl.occupied ? 0 : 3;
  }
  if (command === "inspect") {
    const raw = args[0];
    if (!raw || !/^\d+$/.test(raw))
      throw new AirCtlError("INVALID_INPUT", "Usage: airctl inspect <pid>");
    const proc = await app.engine.inspectPid(Number(raw));
    if (json) io.stdout.write(`${JSON.stringify(proc)}\n`);
    else {
      const [projects, network] = await Promise.all([
        app.engine.projects.detectFromProcesses([proc]),
        app.engine.sockets.discover([], { connections: false }),
      ]);
      io.stdout.write(
        `${formatInspect(proc, { projects, sockets: network.listening }, app.runtime.clock.nowMs(), palette)}\n`,
      );
    }
    return 0;
  }
  if (command === "doctor") {
    const report = await runDoctor(app.engine);
    io.stdout.write(json ? `${JSON.stringify(report)}\n` : `${formatDoctor(report)}\n`);
    return 0;
  }

  const snapshot =
    command === "refresh" || command === "scan"
      ? await app.engine.refresh({ fast: flags.fast })
      : await app.engine.scan({ fast: flags.fast });

  switch (command) {
    case "status":
    case "scan":
    case "refresh":
      if (json)
        io.stdout.write(`${JSON.stringify(snapshotToJson(snapshot, flags.all, flags.project))}\n`);
      else {
        io.stdout.write(
          `${formatStatus(snapshot, {
            env: app.runtime.env,
            tty,
            all: flags.all,
            project: flags.project,
            quiet: flags.quiet,
            nowMs: app.runtime.clock.nowMs(),
          })}\n`,
        );
      }
      return 0;
    case "services":
      if (json)
        io.stdout.write(`${JSON.stringify(snapshotToJson(snapshot, flags.all, flags.project))}\n`);
      else io.stdout.write(`${formatServices(snapshot, flags.all, flags.project, palette)}\n`);
      return 0;
    case "projects":
      if (json) io.stdout.write(`${JSON.stringify(snapshot.projects)}\n`);
      else io.stdout.write(`${formatProjects(snapshot.projects, snapshot)}\n`);
      return 0;
    case "graph":
      if (json) io.stdout.write(`${JSON.stringify(snapshot.graph)}\n`);
      else io.stdout.write(`${formatGraph(snapshot)}\n`);
      return 0;
    default:
      throw new AirCtlError("INVALID_INPUT", `Unknown command: ${command}`);
  }
}

export async function stopCommand(
  app: AppContext,
  args: string[],
  flags: ReturnType<typeof parseArgv>["flags"],
  io: { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream },
): Promise<number> {
  const raw = flags.port ? `:${flags.port}` : args[0];
  if (!raw) throw new AirCtlError("INVALID_INPUT", "Usage: airctl stop <pid|:port|project>");
  const numeric = /^\d+$/.test(raw);
  const pid = numeric ? Number(raw) : undefined;
  const targets =
    pid !== undefined
      ? [
          {
            pid,
            label: `${(await app.engine.inspectPid(pid)).executable ?? "process"} (PID ${pid})`,
          },
        ]
      : resolveStopTargets(
          raw.startsWith(":") || raw.startsWith("port:")
            ? await app.engine.portSnapshot(raw.replace(/^port:/, ""))
            : await app.engine.scan({ fast: true }),
          raw,
        );
  if (!flags.yes && io.stdout.isTTY) {
    io.stdout.write("Are you sure you want to stop:\n\n");
    for (const target of targets) io.stdout.write(`  ${target.label}\n`);
    io.stdout.write("\nType y to confirm.\n");
    const rl = createInterface({ input, output });
    const answer = (await rl.question("> ")).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      io.stdout.write("Aborted.\n");
      return 5;
    }
  } else if (!flags.yes) {
    throw new AirCtlError(
      "CONFIRMATION_REQUIRED",
      "Refusing to stop a process without --yes in a non-interactive session.",
    );
  }
  const results = [];
  for (const target of targets) {
    const result = await app.controller.stop({ pid: target.pid, force: flags.force });
    results.push({ pid: target.pid, ...result });
    if (!flags.json)
      io.stdout.write(
        result.stopped
          ? `Stopped PID ${target.pid} (${result.signal}).\n`
          : `PID ${target.pid} is still running after ${result.signal}.\n`,
      );
  }
  if (flags.json) io.stdout.write(`${JSON.stringify({ stopped: results })}\n`);
  return results.every((result) => result.stopped) ? 0 : 7;
}

async function openCommand(
  app: AppContext,
  args: string[],
  json: boolean,
  io: { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream },
): Promise<number> {
  const name = args[0];
  if (!name) throw new AirCtlError("INVALID_INPUT", "Usage: airctl open <project>");
  const snapshot = app.engine.getSnapshot() ?? (await app.engine.scan({ fast: true }));
  const project = snapshot.projects.find(
    (p) => p.name.toLowerCase() === name.toLowerCase() || p.root === name,
  );
  if (!project) throw new AirCtlError("PROJECT_NOT_FOUND", `Project not found: ${name}`);
  const opener =
    app.runtime.platform === "darwin"
      ? "open"
      : app.runtime.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  const result = await app.runtime.commands.run(opener, [project.root]);
  if (result.code !== 0 || result.timedOut) {
    throw new AirCtlError(
      result.timedOut ? "TIMEOUT" : "DEPENDENCY_UNAVAILABLE",
      `Could not open ${project.root} using ${opener}. ${result.stderr.trim() || "Check that a desktop file opener is installed and available."}`,
    );
  }
  if (json) io.stdout.write(`${JSON.stringify({ opened: project.root })}\n`);
  else io.stdout.write(`Opened ${project.root}\n`);
  return 0;
}

function handleError(
  error: unknown,
  json: boolean,
  io: { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream },
): number {
  if (json) {
    io.stdout.write(`${JSON.stringify(toErrorPayload(error))}\n`);
  } else if (isAirCtlError(error)) {
    io.stderr.write(`${error.message}\n`);
  } else if (error instanceof Error && (error as { code?: string }).code === "PROCESS_NOT_FOUND") {
    io.stderr.write(`${error.message}\n`);
    return 3;
  } else {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
  if (isAirCtlError(error)) return error.exitCode;
  if (error instanceof Error && (error as { code?: string }).code === "PROCESS_NOT_FOUND") return 3;
  if (error instanceof Error && error.message.startsWith("Unknown flag")) return 2;
  if (error instanceof Error && error.message.startsWith("Invalid port")) return 2;
  return 1;
}

function hang(): Promise<void> {
  return new Promise(() => {
    /* keep the UI server running until SIGINT */
  });
}

function suppressSqliteExperimentalWarning(): void {
  const original = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = typeof warning === "string" ? warning : warning.message;
    if (message.includes("SQLite is an experimental feature")) return;
    return (original as (...params: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
