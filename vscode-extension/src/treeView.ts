import * as vscode from "vscode";
import { getStatus, type ServiceEntry, type ProjectEntry, type StatusResult } from "./airctl";

type TreeItem = ProjectNode | ServiceNode | PortNode;

export class AirCtlTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private readonly _onDidChange = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private data: StatusResult | undefined;

  async refresh(): Promise<void> {
    try {
      this.data = await getStatus();
    } catch (err) {
      this.data = undefined;
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`AirCtl: ${msg}`);
    }
    this._onDidChange.fire(undefined);
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
        (p) => new ProjectNode(p, this.data!.services.filter((s) => s.projectId === p.id))
      );

      const unattached = this.data.services.filter((s) => !s.projectId);
      if (unattached.length > 0) {
        projectNodes.push(
          new ProjectNode({ id: "__none__", name: "No project", root: "", markers: [] }, unattached)
        );
      }

      return projectNodes;
    }

    if (element instanceof ProjectNode) {
      return element.services.map((s) => new ServiceNode(s));
    }

    if (element instanceof ServiceNode) {
      return element.service.ports.map((p) => new PortNode(p, element.service));
    }

    return [];
  }
}

class ProjectNode extends vscode.TreeItem {
  constructor(public readonly project: ProjectEntry, public readonly services: ServiceEntry[]) {
    super(project.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "project";
    this.description = project.root ? project.root : undefined;
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

class ServiceNode extends vscode.TreeItem {
  constructor(public readonly service: ServiceEntry) {
    super(service.name, service.ports.length > 0
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);

    this.contextValue = "service";
    this.description = healthLabel(service.health);
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
    case "running":
      return new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"));
    case "unhealthy":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
    case "stopped":
      return new vscode.ThemeIcon("circle-outline");
    case "orphaned":
      return new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
    default:
      return new vscode.ThemeIcon("question");
  }
}

function healthLabel(health: string): string {
  if (health === "healthy" || health === "running") return "healthy";
  return health;
}
