import type { AppContext } from "../engine/app.js";
import { formatStatus } from "../cli/format.js";

export async function runWatchTui(
  app: AppContext,
  options: { all: boolean; project?: string },
): Promise<void> {
  if (!process.stdout.isTTY) {
    const snapshot = await app.engine.scan();
    process.stdout.write(
      `${formatStatus(snapshot, {
        env: app.runtime.env,
        tty: false,
        all: options.all,
        project: options.project,
        quiet: false,
        nowMs: app.runtime.clock.nowMs(),
      })}\n`,
    );
    return;
  }

  const render = async (): Promise<void> => {
    const snapshot = await app.engine.scan();
    const body = formatStatus(snapshot, {
      env: app.runtime.env,
      tty: true,
      all: options.all,
      project: options.project,
      quiet: false,
      nowMs: app.runtime.clock.nowMs(),
    });
    process.stdout.write("\u001b[2J\u001b[H");
    process.stdout.write(`${body}\n\n`);
    process.stdout.write("q quit   r refresh   AirCtl watch\n");
  };

  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  let stopped = false;
  const onKey = (key: string): void => {
    if (key === "q" || key === "\u0003") {
      stopped = true;
      cleanup();
    } else if (key === "r") {
      void render();
    }
  };
  process.stdin.on("data", onKey);

  const cleanup = (): void => {
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    process.stdin.off("data", onKey);
    process.stdout.write("\u001b[0m\n");
  };

  await render();
  app.engine.startAdaptiveLoop();
  const unsub = app.engine.onChange(() => {
    void render();
  });

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (stopped) {
        clearInterval(timer);
        unsub();
        app.engine.stopLoop();
        resolve();
      }
    }, 100);
  });
}
