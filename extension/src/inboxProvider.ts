import * as vscode from "vscode";
import { type InboxItem } from "./api";

const KIND_LABELS: Record<string, string> = {
  dependency: "dependency",
  stale_pr: "stale PR",
  config_change: "config change",
  failing_ci: "failing CI",
  security: "security",
  dependency_upgrade: "dependency",
  docs: "docs",
  mission: "mission",
};

export class InboxProvider implements vscode.TreeDataProvider<InboxNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: InboxItem[] = [];

  refresh(items: InboxItem[]) {
    this.items = items;
    this._onDidChangeTreeData.fire();
  }

  getChildren(element?: InboxNode): InboxNode[] {
    if (element) return [];
    return this.items.map(
      (item) =>
        new InboxNode(
          item.title,
          `${item.priority.toUpperCase()} · ${KIND_LABELS[item.kind] ?? item.kind} · ${item.repo}`,
          vscode.TreeItemCollapsibleState.None,
          item.url ?? undefined,
          item.read,
        ),
    );
  }

  getTreeItem(element: InboxNode): vscode.TreeItem {
    return element;
  }
}

export class InboxNode extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly url?: string,
    read = false,
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.tooltip = typeof label === "string" ? label : undefined;
    this.iconPath = new vscode.ThemeIcon(
      read ? "circle-outline" : "circle-filled",
    );
    if (url) {
      this.command = {
        command: "vscode.open",
        title: "Open",
        arguments: [vscode.Uri.parse(url)],
      };
    }
  }
}
