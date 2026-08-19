#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
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
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
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

  const app = await createApp({
    verbose: parsed.flags.verbose,
    configPath: parsed.flags.config,
    json: parsed.flags.json,
  });

  try {
    return await dispatch(app, parsed.command, parsed.args, parsed.flags, io);
  } catch (error) {
    return handleError(error, parsed.flags.json, io);
  } finally {
    await app.engine.close();
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

  const snapshot =
    command === "refresh" || command === "scan"
      ? await app.engine.refresh()
      : await app.engine.scan();

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
    case "explain": {
      const port = flags.port ?? args[0];
      if (!port) throw new AirCtlError("INVALID_INPUT", "Usage: airctl explain <port>");
      const expl = await app.engine.explainPort(port);
      if (json) io.stdout.write(`${JSON.stringify(expl)}\n`);
      else io.stdout.write(`${formatExplanation(expl, app.runtime.clock.nowMs())}\n`);
      return expl.occupied ? 0 : 3;
    }
    case "inspect": {
      const pidRaw = args[0];
      if (!pidRaw || !/^\d+$/.test(pidRaw))
        throw new AirCtlError("INVALID_INPUT", "Usage: airctl inspect <pid>");
      const pid = Number.parseInt(pidRaw, 10);
      const proc = await app.engine.inspectPid(pid);
      if (json) io.stdout.write(`${JSON.stringify(proc)}\n`);
      else
        io.stdout.write(`${formatInspect(proc, snapshot, app.runtime.clock.nowMs(), palette)}\n`);
      return 0;
    }
    case "doctor": {
      const report = await runDoctor(app.engine);
      if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
      else io.stdout.write(`${formatDoctor(report)}\n`);
      return 0;
    }
    case "logs": {
      const events = snapshot.events;
      if (json) io.stdout.write(`${JSON.stringify(events)}\n`);
      else {
        if (events.length === 0) io.stdout.write("No activity yet.\n");
        else for (const event of events) io.stdout.write(`${event.at}  ${event.message}\n`);
      }
      return 0;
    }
    default:
      throw new AirCtlError("INVALID_INPUT", `Unknown command: ${command}`);
  }
}

async function stopCommand(
  app: AppContext,
  args: string[],
  flags: ReturnType<typeof parseArgv>["flags"],
  io: { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream },
): Promise<number> {
  const snapshot = app.engine.getSnapshot() ?? (await app.engine.scan());
  const raw = flags.port ? `:${flags.port}` : args[0];
  if (!raw) throw new AirCtlError("INVALID_INPUT", "Usage: airctl stop <pid|:port|project>");
  const targets = resolveStopTargets(snapshot, raw);
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
    if (!flags.json) io.stdout.write(`Stopped PID ${target.pid} (${result.signal}).\n`);
  }
  if (flags.json) io.stdout.write(`${JSON.stringify({ stopped: results })}\n`);
  return 0;
}

async function openCommand(
  app: AppContext,
  args: string[],
  json: boolean,
  io: { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream },
): Promise<number> {
  const name = args[0];
  if (!name) throw new AirCtlError("INVALID_INPUT", "Usage: airctl open <project>");
  const snapshot = app.engine.getSnapshot() ?? (await app.engine.scan());
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
  await app.runtime.commands.run(opener, [project.root]);
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
    return path.normalize(fileURLToPath(import.meta.url)) === path.normalize(entry);
  } catch {
    return entry.endsWith("cli.js") || entry.endsWith("cli.ts");
  }
}

if (isEntrypoint()) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
