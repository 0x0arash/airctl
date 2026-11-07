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
    } catch {
      this.item.text = "$(radio-tower) AirCtl";
    }
  }

  startAutoRefresh(): void {
    this.stopAutoRefresh();
    const intervalSec = vscode.workspace
      .getConfiguration("airctl")
      .get<number>("refreshInterval", 10);
    this.timer = setInterval(() => void this.refresh(), intervalSec * 1000);
    void this.refresh();
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
