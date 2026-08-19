import * as vscode from "vscode";
import { explainPort, stopProcess } from "./airctl";
import type { AirCtlTreeProvider } from "./treeView";

export function registerCommands(
  context: vscode.ExtensionContext,
  tree: AirCtlTreeProvider,
  onRefresh: () => Promise<void>,
) {
  context.subscriptions.push(
    vscode.commands.registerCommand("airctl.explainPort", async (item?: { port?: number }) => {
      let port = item?.port;

      if (port === undefined) {
        const editor = vscode.window.activeTextEditor;
        const selected = editor?.document.getText(editor.selection).trim();
        const match = selected?.match(/^:?(\d{2,5})$/);
        if (match) {
          port = Number(match[1]);
        }
      }

      if (port === undefined) {
        const input = await vscode.window.showInputBox({
          prompt: "Enter a port number",
          placeHolder: "3000",
          validateInput: (v) => (/^\d{2,5}$/.test(v) ? null : "Enter a valid port number"),
        });
        if (!input) return;
        port = Number(input);
      }

      try {
        const result = await explainPort(port);
        const channel = vscode.window.createOutputChannel("AirCtl");
        channel.clear();
        channel.appendLine(`Port ${result.port}`);
        channel.appendLine(result.occupied ? "OCCUPIED" : "FREE");
        if (result.process) {
          channel.appendLine(`  Process: ${result.process.executable ?? "unknown"} (PID ${result.process.pid})`);
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
      } catch (err) {
        vscode.window.showErrorMessage(`AirCtl: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("airctl.stopService", async (item?: { service?: { processId?: number | null; name?: string } }) => {
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
        await stopProcess(pid);
        vscode.window.showInformationMessage(`AirCtl: Stopped PID ${pid}.`);
        await onRefresh();
      } catch (err) {
        vscode.window.showErrorMessage(`AirCtl: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
}
