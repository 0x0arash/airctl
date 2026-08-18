import path from "node:path";
import { createNodeRuntime, type Runtime } from "../runtime/index.js";
import { loadConfig, configDir, type AirCtlConfig } from "../config/load.js";
import { createStore, type SnapshotStore } from "../storage/store.js";
import { DiscoveryEngine } from "./engine.js";
import { createLogger, type LogLevel } from "../logging/logger.js";
import { PlatformProcessController } from "../control/stop.js";

export interface AppContext {
  runtime: Runtime;
  config: AirCtlConfig;
  configPath?: string;
  store: SnapshotStore;
  engine: DiscoveryEngine;
  controller: PlatformProcessController;
}

export async function createApp(options: {
  verbose?: boolean;
  configPath?: string;
  json?: boolean;
}): Promise<AppContext> {
  const runtime = await createNodeRuntime();
  const loaded = await loadConfig(
    runtime.fs,
    runtime.homedir(),
    runtime.platform,
    options.configPath,
  );
  const dbPath = path.join(configDir(runtime.homedir(), runtime.platform), "airctl.sqlite");
  const store = await createStore(dbPath);
  const level: LogLevel = options.verbose ? "debug" : "warn";
  const engine = new DiscoveryEngine({
    runtime,
    store,
    config: loaded.config,
    logger: createLogger(level, options.json === true),
  });
  const controller = new PlatformProcessController(
    runtime.platform,
    (pid) => engine.inspectPid(pid).catch(() => undefined),
    runtime.commands,
  );
  return {
    runtime,
    config: loaded.config,
    configPath: loaded.path,
    store,
    engine,
    controller,
  };
}
