import * as vscode from "vscode";
import type { StatusResult } from "./airctl";

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private lastStatus?: StatusResult;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = "airctl.findService";
    this.item.tooltip = "AirCtl — connecting to local discovery";
    this.item.text = "$(sync~spin) AirCtl";
    this.item.show();
  }

  update(status: StatusResult): void {
    this.lastStatus = status;
    const { services, healthy, unhealthy } = status.summary;
    let label = `$(radio-tower) ${services} service${services === 1 ? "" : "s"}`;
    if (unhealthy > 0) label += ` (${unhealthy} unhealthy)`;
    else if (healthy > 0) label += ` — ${healthy} healthy`;
    this.item.text = label;
    const health = status.capabilities?.httpHealth;
    this.item.tooltip = `Scanned ${new Date(status.scannedAt).toLocaleTimeString()}. ${health?.ok ? "Health probes enabled." : (health?.detail ?? "Live service inventory.")} Click to find a service.`;
  }

  failed(error: Error): void {
    this.item.text = `$(warning) AirCtl${this.lastStatus ? ` · ${this.lastStatus.summary.services} services (stale)` : ""}`;
    this.item.tooltip = `${error.message}${this.lastStatus ? ` Last successful scan: ${new Date(this.lastStatus.scannedAt).toLocaleTimeString()}.` : ""} Reconnecting; refresh to try again.`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
