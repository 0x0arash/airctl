import * as vscode from "vscode";
import { StatusBarController } from "./statusBar";
import { AirCtlTreeProvider } from "./treeView";
import { registerCommands } from "./commands";
import { startDiscovery, refreshStatus } from "./airctl";

export function activate(context: vscode.ExtensionContext) {
  const statusBar = new StatusBarController();
  const treeProvider = new AirCtlTreeProvider();
  const treeView = vscode.window.createTreeView("airctl.services", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  const failed = (error: Error): void => {
    statusBar.failed(error);
    treeView.message =
      "Connection interrupted. Showing the last successful result while reconnecting.";
  };
  async function refreshAll(): Promise<void> {
    try {
      const status = await refreshStatus();
      statusBar.update(status);
      treeProvider.update(status);
      treeView.message = undefined;
    } catch (error) {
      failed(error instanceof Error ? error : new Error(String(error)));
    }
  }
  let discovery: vscode.Disposable | undefined;
  const connect = (): void => {
    discovery?.dispose();
    discovery = startDiscovery((status) => {
      statusBar.update(status);
      treeProvider.update(status);
      treeView.message = undefined;
      treeView.description = `Updated ${new Date(status.scannedAt).toLocaleTimeString()}`;
    }, failed);
  };
  context.subscriptions.push(
    statusBar,
    treeProvider,
    treeView,
    { dispose: () => discovery?.dispose() },
    vscode.commands.registerCommand("airctl.refresh", () => refreshAll()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("airctl")) connect();
    }),
  );
  registerCommands(context, treeProvider, refreshAll);
  connect();
}

export function deactivate() {
  /* Disposables close the private discovery session. */
}
