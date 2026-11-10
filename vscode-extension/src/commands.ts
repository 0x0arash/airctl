import * as vscode from "vscode";
import {
  explainPort,
  stopProcess,
  getStatus,
  tuiTerminalOptions,
  type ServiceEntry,
  type ProjectEntry,
} from "./airctl";
import type { AirCtlTreeProvider } from "./treeView";

export function registerCommands(
  context: vscode.ExtensionContext,
  tree: AirCtlTreeProvider,
  onRefresh: () => Promise<void>,
) {
  const channel = vscode.window.createOutputChannel("AirCtl");
  context.subscriptions.push(channel);
  context.subscriptions.push(
    vscode.commands.registerCommand("airctl.openTui", () => {
      const terminal = vscode.window.createTerminal(tuiTerminalOptions());
      terminal.show();
    }),
    vscode.commands.registerCommand("airctl.findService", async () => {
      try {
        const status = await getStatus();
        const selected = await vscode.window.showQuickPick(
          status.services.map((service) => {
            const project = status.projects.find((item) => item.id === service.projectId);
            return {
              label: service.ports.map((port) => `:${port}`).join(", ") + `  ${service.name}`,
              description: project?.name ?? "No project",
              detail: `PID ${service.processId ?? "unavailable"} · ${service.health}${project ? ` · ${project.root}` : ""}`,
              service,
              project,
            };
          }),
          {
            placeHolder: "Find a service by port, project, PID, or name",
            matchOnDescription: true,
            matchOnDetail: true,
          },
        );
        if (selected) await vscode.commands.executeCommand("airctl.inspectService", selected);
      } catch (error) {
        vscode.window.showErrorMessage(
          `AirCtl: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
    vscode.commands.registerCommand(
      "airctl.inspectService",
      async (item?: { service?: ServiceEntry; project?: ProjectEntry }) => {
        if (!item?.service) {
          await vscode.commands.executeCommand("airctl.findService");
          return;
        }
        const { service, project } = item;
        const actions = service.ports.flatMap((port) => [
          { label: `Explain :${port}`, id: "explain", port },
          { label: `Open http://localhost:${port}`, id: "open", port },
          { label: `Copy localhost:${port}`, id: "copy", port },
        ]);
        if (project?.root)
          actions.push({ label: `Reveal project ${project.name}`, id: "project", port: 0 });
        if (service.processId)
          actions.push({
            label: `Stop ${service.name} (PID ${service.processId})…`,
            id: "stop",
            port: 0,
          });
        const action = await vscode.window.showQuickPick(actions, {
          placeHolder: `${service.name} · ${project?.name ?? "No project"} · ${service.health}`,
        });
        if (!action) return;
        if (action.id === "explain")
          await vscode.commands.executeCommand("airctl.explainPort", { port: action.port });
        if (action.id === "open")
          await vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${action.port}`));
        if (action.id === "copy") await vscode.env.clipboard.writeText(`localhost:${action.port}`);
        if (action.id === "project" && project)
          await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(project.root));
        if (action.id === "stop")
          await vscode.commands.executeCommand("airctl.stopService", { service });
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("airctl.explainPort", async (item?: { port?: number }) => {
      let port = item?.port;

      if (port === undefined) {
        const editor = vscode.window.activeTextEditor;
        const selected = editor?.document.getText(editor.selection).trim();
        const match = selected?.match(/^:?(\d{1,5})$/);
        if (match) {
          port = Number(match[1]);
        }
      }

      if (port === undefined) {
        const input = await vscode.window.showInputBox({
          prompt: "Enter a port number",
          placeHolder: "3000",
          validateInput: (v) =>
            /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535
              ? null
              : "Enter a port between 1 and 65535",
        });
        if (!input) return;
        port = Number(input);
      }

      try {
        const result = await explainPort(port);
        channel.clear();
        channel.appendLine(`Port ${result.port}`);
        channel.appendLine(result.occupied ? "OCCUPIED" : "FREE");
        if (result.process) {
          channel.appendLine(
            `  Process: ${result.process.executable ?? "unknown"} (PID ${result.process.pid})`,
          );
          if (result.process.cwd) channel.appendLine(`  CWD: ${result.process.cwd}`);
          if (result.process.command) channel.appendLine(`  Command: ${result.process.command}`);
        }
        if (result.project) {
          channel.appendLine(`  Project: ${result.project.name} (${result.project.root})`);
        }
        if (result.service) {
          channel.appendLine(`  Service: ${result.service.name} — ${result.service.health}`);
        }
        if (result.likelyIssue) {
          channel.appendLine(`  Issue: ${result.likelyIssue}`);
        }
        if (result.actions.length > 0) {
          channel.appendLine(`  Actions: ${result.actions.join(", ")}`);
        }
        channel.show(true);
        if (result.occupied && result.process) {
          const action = await vscode.window.showInformationMessage(
            `:${result.port} → ${result.process.executable ?? "process"} · PID ${result.process.pid}${result.project ? ` · ${result.project.name}` : ""}`,
            "Open localhost",
            "Stop process",
          );
          if (action === "Open localhost")
            await vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${result.port}`));
          if (action === "Stop process")
            await vscode.commands.executeCommand("airctl.stopService", {
              service: {
                processId: result.process.pid,
                name: result.service?.name ?? result.process.executable,
              },
            });
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `AirCtl: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand(
      "airctl.stopService",
      async (item?: { service?: { processId?: number | null; name?: string } }) => {
        const pid = item?.service?.processId;
        if (!pid) {
          vscode.window.showWarningMessage("AirCtl: No process ID available for this service.");
          return;
        }

        const answer = await vscode.window.showWarningMessage(
          `Stop ${item?.service?.name ?? "service"} (PID ${pid})?`,
          { modal: true },
          "Stop",
        );
        if (answer !== "Stop") return;

        try {
          const result = await stopProcess(pid);
          if (!result.stopped.length || result.stopped.some((entry) => !entry.stopped)) {
            vscode.window.showWarningMessage(
              `AirCtl: PID ${pid} is still running after the termination request.`,
            );
            await onRefresh();
            return;
          }
          vscode.window.showInformationMessage(`AirCtl: Stopped PID ${pid}.`);
          await onRefresh();
        } catch (err) {
          vscode.window.showErrorMessage(
            `AirCtl: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    ),
  );
}
