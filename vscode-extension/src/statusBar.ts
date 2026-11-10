import * as vscode from "vscode";
import { getStatus } from "./airctl";

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = "airctl.services.focus";
    this.item.tooltip = "AirCtl — local development services";
    this.item.text = "$(radio-tower) AirCtl";
    this.item.show();
  }

  async refresh(): Promise<void> {
    if (this.item.text === "$(radio-tower) AirCtl") this.item.text = "$(sync~spin) AirCtl";
    try {
      const status = await getStatus();
      const { services, healthy, unhealthy } = status.summary;
      let label = `$(radio-tower) ${services} service${services === 1 ? "" : "s"}`;
      if (unhealthy > 0) {
        label += ` (${unhealthy} unhealthy)`;
      } else if (healthy > 0) {
        label += ` — ${healthy} healthy`;
      }
      this.item.text = label;
      const detailed = vscode.workspace
        .getConfiguration("airctl")
        .get<boolean>("detailedDiscovery", false);
      this.item.tooltip = detailed
        ? "AirCtl — full discovery with Docker and health probes. Click to browse."
        : "AirCtl — fast service inventory (health probes skipped). Click to browse, or run AirCtl: Find Service.";
    } catch {
      this.item.text = "$(warning) AirCtl";
      this.item.tooltip = "AirCtl could not refresh. Check the CLI path and refresh the sidebar.";
    }
  }

  startAutoRefresh(onRefresh: () => Promise<void> = () => this.refresh()): void {
    this.stopAutoRefresh();
    const intervalSec = vscode.workspace
      .getConfiguration("airctl")
      .get<number>("refreshInterval", 10);
    this.timer = setInterval(() => void onRefresh(), intervalSec * 1000);
    void onRefresh();
  }

  stopAutoRefresh(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.stopAutoRefresh();
    this.item.dispose();
  }
}
