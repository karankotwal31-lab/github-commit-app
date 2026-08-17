import * as vscode from "vscode";
import { type Whoami } from "./api";

export class AccountProvider implements vscode.TreeDataProvider<AccountNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private whoami: Whoami | null = null;
  private signedIn = false;

  refresh(whoami: Whoami | null, signedIn: boolean) {
    this.whoami = whoami;
    this.signedIn = signedIn;
    this._onDidChangeTreeData.fire();
  }

  getChildren(): AccountNode[] {
    if (!this.signedIn) {
      return [
        new AccountNode(
          "Not signed in",
          "Run Aria: Sign in (paste access token)",
          vscode.TreeItemCollapsibleState.None,
        ),
      ];
    }
    const nodes: AccountNode[] = [];
    const aria = this.whoami?.user?.name ?? "(no name)";
    nodes.push(
      new AccountNode("Aria user", aria, vscode.TreeItemCollapsibleState.None),
    );
    if (this.whoami?.github) {
      nodes.push(
        new AccountNode(
          "GitHub",
          `@${this.whoami.github.login}`,
          vscode.TreeItemCollapsibleState.None,
        ),
      );
    } else {
      nodes.push(
        new AccountNode(
          "GitHub",
          "not connected",
          vscode.TreeItemCollapsibleState.None,
        ),
      );
    }
    return nodes;
  }

  getTreeItem(element: AccountNode): vscode.TreeItem {
    return element;
  }
}

export class AccountNode extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.tooltip = description;
  }
}
