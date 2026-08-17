import * as vscode from "vscode";
import { AriaApi, FindingRow, kindLabel, PrRow, RepoRow } from "./api";

/** Lets providers read the stored token without knowing where it lives. */
export interface TokenProvider {
  getToken(): Promise<string | null>;
}

export interface TreeRow {
  label: string;
  description?: string;
  tooltip?: string;
  url?: string;
  icon?: string;
  command?: string;
}

function signInRow(): TreeRow {
  return {
    label: "Sign in to Aria",
    description: "Create a token in the web app (Platform → CLI & API)",
    command: "aria.login",
    icon: "key",
  };
}

function errorRow(err: unknown): TreeRow {
  const message =
    err instanceof Error
      ? err.message
      : "Something went wrong — try the “Aria: Refresh” command.";
  return { label: message, icon: "error" };
}

function toTreeItem(row: TreeRow): vscode.TreeItem {
  const item = new vscode.TreeItem(row.label);
  item.description = row.description;
  item.tooltip = row.tooltip ?? row.description;
  if (row.icon) item.iconPath = new vscode.ThemeIcon(row.icon);
  if (row.url) {
    item.command = {
      command: "aria.openUrl",
      title: "Open",
      arguments: [row.url],
    };
  } else if (row.command) {
    item.command = { command: row.command, title: "Run" };
  }
  return item;
}

export class ReposProvider implements vscode.TreeDataProvider<TreeRow> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(
    private readonly api: AriaApi,
    private readonly tokenProvider: TokenProvider,
  ) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  async getChildren(): Promise<TreeRow[]> {
    const token = await this.tokenProvider.getToken();
    if (!token) return [signInRow()];
    try {
      const rows = await this.api.repos(token);
      if (rows.length === 0) {
        return [{ label: "No connected repositories", icon: "repo" }];
      }
      return rows.map((r: RepoRow) => ({
        label: r.repo,
        description: r.private ? "private" : "",
        icon: "repo",
      }));
    } catch (err) {
      return [errorRow(err)];
    }
  }

  getTreeItem(row: TreeRow): vscode.TreeItem {
    return toTreeItem(row);
  }
}

export class PrsProvider implements vscode.TreeDataProvider<TreeRow> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(
    private readonly api: AriaApi,
    private readonly tokenProvider: TokenProvider,
  ) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  async getChildren(): Promise<TreeRow[]> {
    const token = await this.tokenProvider.getToken();
    if (!token) return [signInRow()];
    try {
      const rows = await this.api.prs(token);
      if (rows.length === 0) {
        return [{ label: "No open pull requests", icon: "git-pull-request" }];
      }
      return rows.map((pr: PrRow) => ({
        label: `#${pr.number}${pr.draft ? " (draft)" : ""} ${pr.title}`,
        description: pr.updatedAt ? pr.updatedAt.slice(0, 10) : "",
        tooltip: `${pr.repo} — updated ${pr.updatedAt ?? "unknown"}`,
        url: pr.htmlUrl,
        icon: pr.draft ? "git-pull-request-draft" : "git-pull-request",
      }));
    } catch (err) {
      return [errorRow(err)];
    }
  }

  getTreeItem(row: TreeRow): vscode.TreeItem {
    return toTreeItem(row);
  }
}

export class InboxProvider implements vscode.TreeDataProvider<TreeRow> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(
    private readonly api: AriaApi,
    private readonly tokenProvider: TokenProvider,
  ) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  async getChildren(): Promise<TreeRow[]> {
    const token = await this.tokenProvider.getToken();
    if (!token) return [signInRow()];
    try {
      const rows = await this.api.inbox(token);
      if (rows.length === 0) {
        return [{ label: "Inbox is clear", icon: "inbox" }];
      }
      return rows.map((f: FindingRow) => ({
        label: `${f.read ? "" : "● "}${f.title}`,
        description: `${kindLabel(f.kind)} · ${f.repo}`,
        tooltip: `${f.detail}\n\n${f.url ?? ""}`,
        url: f.url ?? undefined,
        icon: "bell",
      }));
    } catch (err) {
      return [errorRow(err)];
    }
  }

  getTreeItem(row: TreeRow): vscode.TreeItem {
    return toTreeItem(row);
  }
}
