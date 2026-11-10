import * as vscode from "vscode";
import { getStatus, type ServiceEntry, type ProjectEntry, type StatusResult } from "./airctl";

type TreeItem = ProjectNode | ServiceNode | PortNode;

export class AirCtlTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private data: StatusResult | undefined;

  async refresh(): Promise<void> {
    try {
      this.data = await getStatus();
    } catch (err) {
      // Keep the last successful inventory visible on transient failures.
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.setStatusBarMessage(`AirCtl refresh failed: ${msg}`, 5000);
    }
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!this.data) return [];

    if (!element) {
      const projects = this.data.projects;
      if (projects.length === 0 && this.data.services.length === 0) return [];

      const projectNodes = projects.map(
        (p) =>
          new ProjectNode(
            p,
            this.data!.services.filter((s) => s.projectId === p.id),
          ),
      );

      const unattached = this.data.services.filter((s) => !s.projectId);
      if (unattached.length > 0) {
        projectNodes.push(
          new ProjectNode(
            { id: "__none__", name: "No project", root: "", markers: [] },
            unattached,
          ),
        );
      }

      return projectNodes;
    }

    if (element instanceof ProjectNode) {
      return element.services.map((s) => new ServiceNode(s, element.project));
    }

    if (element instanceof ServiceNode) {
      return element.service.ports.map((p) => new PortNode(p, element.service));
    }

    return [];
  }
}

class ProjectNode extends vscode.TreeItem {
  constructor(
    public readonly project: ProjectEntry,
    public readonly services: ServiceEntry[],
  ) {
    super(project.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "project";
    this.description = `${services.length} service${services.length === 1 ? "" : "s"}`;
    this.tooltip = project.root;
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

class ServiceNode extends vscode.TreeItem {
  constructor(
    public readonly service: ServiceEntry,
    public readonly project?: ProjectEntry,
  ) {
    super(
      service.name,
      service.ports.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    this.contextValue = "service";
    this.description = `${service.ports.map((port) => `:${port}`).join(", ")} · ${healthLabel(service.health)}`;
    this.command = {
      command: "airctl.inspectService",
      title: "Service actions",
      arguments: [this],
    };
    this.iconPath = healthIcon(service.health);

    if (service.processId) {
      this.tooltip = `PID ${service.processId} · ${service.classification}`;
    }
  }
}

class PortNode extends vscode.TreeItem {
  public readonly port: number;

  constructor(port: number, service: ServiceEntry) {
    super(`:${port}`, vscode.TreeItemCollapsibleState.None);
    this.port = port;
    this.contextValue = "port";
    this.iconPath = new vscode.ThemeIcon("plug");
    this.tooltip = `Port ${port} · ${service.name}`;
  }
}

function healthIcon(health: string): vscode.ThemeIcon {
  switch (health) {
    case "healthy":
      return new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"));
    case "running":
      return new vscode.ThemeIcon("circle-filled");
    case "unhealthy":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
    case "stopped":
      return new vscode.ThemeIcon("circle-outline");
    case "orphaned":
      return new vscode.ThemeIcon(
        "warning",
        new vscode.ThemeColor("problemsWarningIcon.foreground"),
      );
    default:
      return new vscode.ThemeIcon("question");
  }
}

function healthLabel(health: string): string {
  if (health === "healthy") return "healthy";
  if (health === "running") return "running (not probed)";
  return health;
}
