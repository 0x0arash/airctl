import * as vscode from "vscode";
import { StatusBarController } from "./statusBar";
import { AirCtlTreeProvider } from "./treeView";
import { registerCommands } from "./commands";

export function activate(context: vscode.ExtensionContext) {
  const statusBar = new StatusBarController();
  const treeProvider = new AirCtlTreeProvider();

  const treeView = vscode.window.createTreeView("airctl.services", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  async function refreshAll() {
    await Promise.all([statusBar.refresh(), treeProvider.refresh()]);
  }

  context.subscriptions.push(
    statusBar,
    treeProvider,
    treeView,
    vscode.commands.registerCommand("airctl.refresh", () => refreshAll()),
  );

  registerCommands(context, treeProvider, refreshAll);

  statusBar.startAutoRefresh(refreshAll);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("airctl")) statusBar.startAutoRefresh(refreshAll);
    }),
  );
}

export function deactivate() {
  // StatusBarController.dispose() is called via subscriptions
}
