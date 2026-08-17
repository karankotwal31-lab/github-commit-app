/**
 * Aria for VS Code — a thin client for the same backend as the web app.
 *
 * Authentication uses the same personal access tokens as the Aria CLI
 * (created in the app under Platform → CLI & API). The token is stored in
 * VS Code's SecretStorage (OS keychain), never in plaintext, and only ever
 * grants access to YOUR account on the Aria backend — it is not a GitHub
 * token and cannot read anyone else's data.
 *
 * Commands:
 *   Aria: Sign in (paste access token)   aria.login
 *   Aria: Sign out                       aria.logout
 *   Aria: Refresh inbox                  aria.refresh
 *   Open in Aria (editor context menu)   aria.openInAria
 *
 * Views (activity bar → Aria):
 *   Inbox    — Aria's engineering findings (deps, stale PRs, CI, config)
 *   Account  — who this token is (Aria user + GitHub handle)
 */

import * as vscode from "vscode";

const DEFAULT_URL = "https://steady-scorpion-839.convex.site";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

interface Whoami {
  user: { name: string | null } | null;
  github: { login: string; name: string | null } | null;
}

interface Finding {
  kind: string;
  priority: string;
  repo: string;
  title: string;
  detail: string;
  url: string | null;
  read: boolean;
  createdAt: number;
}

class ApiClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${this.base}${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!res.ok) {
        const detail =
          typeof body === "string" ? body : JSON.stringify(body ?? null);
        throw new Error(`Aria API ${path} failed (${res.status}): ${detail}`);
      }
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

// --- State ----------------------------------------------------------------

let token: string | null = null;
let baseUrl = DEFAULT_URL;
let inboxProvider: InboxProvider | null = null;
let accountProvider: AccountProvider | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;

function readConfig(): void {
  baseUrl =
    vscode.workspace
      .getConfiguration("aria")
      .get<string>("url", DEFAULT_URL)
      .replace(/\/+$/, "") || DEFAULT_URL;
}

function client(): ApiClient | null {
  if (!token) return null;
  return new ApiClient(baseUrl, token);
}

// --- Tree views ------------------------------------------------------------

const KIND_ICONS: Record<string, string> = {
  dependency: "package",
  stale_pr: "git-pull-request",
  config_change: "lock",
  failing_ci: "error",
  security: "shield",
  dependency_upgrade: "package",
  docs: "file-text",
  mission: "check",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "charts.red",
  medium: "charts.yellow",
  low: "charts.green",
};

class FindingItem extends vscode.TreeItem {
  constructor(readonly finding: Finding) {
    super(
      finding.title,
      finding.read ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.None,
    );
    this.description = `${finding.priority} · ${finding.repo}`;
    this.tooltip = new vscode.MarkdownString(
      `**${finding.title}**\n\n${finding.detail}\n\n\`${finding.repo}\``,
    );
    this.tooltip.isTrusted = true;
    this.iconPath = new vscode.ThemeIcon(
      KIND_ICONS[finding.kind] ?? "lightbulb",
      new vscode.ThemeColor(PRIORITY_COLORS[finding.priority] ?? "descriptionForeground"),
    );
    this.contextValue = "finding";
    this.command = {
      command: "aria.openFinding",
      title: "Open finding",
      arguments: [finding],
    };
  }
}

class InboxProvider implements vscode.TreeDataProvider<FindingItem> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<FindingItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: FindingItem[] = [];

  set(findings: Finding[]): void {
    this.items = findings.map((f) => new FindingItem(f));
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FindingItem): vscode.TreeItem {
    return element;
  }

  getChildren(): FindingItem[] {
    return this.items;
  }
}

class AccountItem extends vscode.TreeItem {
  constructor(label: string, description: string, command?: vscode.Command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon("account");
    if (command) this.command = command;
  }
}

class AccountProvider implements vscode.TreeDataProvider<AccountItem> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<AccountItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private item: AccountItem = new AccountItem(
    "Not signed in",
    "Run “Aria: Sign in”",
    { command: "aria.login", title: "Sign in" },
  );

  setSignedIn(me: Whoami): void {
    const name = me.user?.name ?? me.github?.name ?? "Aria user";
    const github = me.github ? `@${me.github.login}` : "GitHub not connected";
    this.item = new AccountItem(`Signed in as ${name}`, github, {
      command: "aria.logout",
      title: "Sign out",
    });
    this._onDidChangeTreeData.fire();
  }

  setSignedOut(): void {
    this.item = new AccountItem("Not signed in", "Run “Aria: Sign in”", {
      command: "aria.login",
      title: "Sign in",
    });
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AccountItem): vscode.TreeItem {
    return element;
  }

  getChildren(): AccountItem[] {
    return [this.item];
  }
}

// --- Commands --------------------------------------------------------------

async function cmdLogin(context: vscode.ExtensionContext): Promise<void> {
  readConfig();
  const choice = await vscode.window.showInformationMessage(
    "Create an Aria access token first: open the Aria app, then Platform → CLI & API → Create token. Paste it below.",
    "Open Aria",
  );
  if (choice === "Open Aria") {
    await vscode.env.openExternal(vscode.Uri.parse(baseUrl));
  }
  const value = await vscode.window.showInputBox({
    prompt: "Aria access token (starts with aria_)",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) =>
      v && v.startsWith("aria_") ? undefined : "Tokens start with aria_",
  });
  if (!value) return;
  try {
    const probe = new ApiClient(baseUrl, value);
    await probe.get<Whoami>("/api/cli/whoami");
    await context.secrets.store("aria.token", value);
    token = value;
    vscode.window.showInformationMessage("Aria: signed in.");
    await refreshAll(context);

  } catch (e) {
    vscode.window.showErrorMessage(
      `Aria: token rejected — ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function cmdLogout(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete("aria.token");
  token = null;
  await refreshAll(context);
  vscode.window.showInformationMessage("Aria: signed out.");
}


function cmdOpenFinding(finding: Finding): void {
  const target = finding.url ?? `${baseUrl}/dashboard`;
  void vscode.env.openExternal(vscode.Uri.parse(target));
}

/** Best-effort: detect the GitHub repo of the active workspace via the
 *  built-in Git extension (origin remote) and the active file's relative
 *  path, then open Aria straight on that file (?repo=&path= deep link).
 *  Falls back to the plain dashboard. */
async function cmdOpenInAria(): Promise<void> {
  readConfig();
  let repo: string | null = null;
  try {
    const git = vscode.extensions.getExtension("vscode.git");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = git?.isActive ? git.exports.getAPI(1) : null;
    const folder = vscode.workspace.workspaceFolders?.[0];
    const repositories = api?.repositories ?? [];
    const active =
      folder !== undefined
        ? repositories.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (r: any) => r?.rootUri?.toString() === folder.uri.toString(),
          )
        : undefined;
    const remote =
      active?.state?.remotes?.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => r?.name === "origin",
      ) ?? active?.state?.remotes?.[0];
    const remoteUrl: string = remote?.fetchUrl ?? remote?.pushUrl ?? "";
    const m = /github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/.exec(remoteUrl);
    repo = m ? m[1] : null;
  } catch {
    repo = null; // git API unavailable — open Aria anyway
  }
  const params = new URLSearchParams();
  if (repo) params.set("repo", repo);
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const folder = vscode.workspace.getWorkspaceFolder(activeUri ?? vscode.Uri.file("/"));
  if (activeUri && folder) {
    const rel = vscode.workspace.asRelativePath(activeUri, false);
    if (rel && !rel.startsWith("..")) params.set("path", rel);
  }
  const qs = params.toString();
  const target = `${baseUrl}/dashboard${qs ? `?${qs}` : ""}`;
  void vscode.env.openExternal(vscode.Uri.parse(target));
}

// --- Refresh ---------------------------------------------------------------

async function refreshAll(context: vscode.ExtensionContext): Promise<void> {
  readConfig();
  token = (await context.secrets.get("aria.token")) ?? null;
  const api = client();
  if (!api) {
    inboxProvider?.set([]);
    accountProvider?.setSignedOut();
    if (statusBarItem) {
      statusBarItem.text = "$(graph) Aria: not signed in";
      statusBarItem.tooltip = "Run “Aria: Sign in” to connect";
      statusBarItem.command = "aria.login";
      statusBarItem.show();
    }
    return;
  }
  try {
    const [me, findings] = await Promise.all([
      api.get<Whoami>("/api/cli/whoami"),
      api.get<Finding[]>("/api/cli/inbox"),
    ]);
    inboxProvider?.set(findings ?? []);
    accountProvider?.setSignedIn(me);
    const unread = (findings ?? []).filter((f) => !f.read).length;
    if (statusBarItem) {
      statusBarItem.text =
        unread > 0
          ? `$(graph) Aria: @${me.github?.login ?? "?"} · ${unread} new`
          : `$(graph) Aria: @${me.github?.login ?? "?"}`;
      statusBarItem.tooltip = `${unread} unread finding${unread === 1 ? "" : "s"} — click to refresh`;
      statusBarItem.command = "aria.refresh";
      statusBarItem.show();
    }
  } catch (e) {
    // Token rejected or backend unreachable — drop the token and re-prompt.
    try {
      await context.secrets.delete("aria.token");
    } catch {
      // Storage hiccup — continue.
    }
    token = null;
    inboxProvider?.set([]);
    accountProvider?.setSignedOut();
    if (statusBarItem) {
      statusBarItem.text = "$(graph) Aria: sign in";
      statusBarItem.command = "aria.login";
      statusBarItem.show();
    }
    vscode.window.showErrorMessage(
      `Aria: ${e instanceof Error ? e.message : String(e)} — sign in again.`,
    );
  }
}

// --- Activation ------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  readConfig();

  inboxProvider = new InboxProvider();
  accountProvider = new AccountProvider();
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    60,
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("aria.inboxView", inboxProvider),
    vscode.window.registerTreeDataProvider("aria.accountView", accountProvider),
    vscode.commands.registerCommand("aria.login", () => cmdLogin(context)),
    vscode.commands.registerCommand("aria.logout", () => cmdLogout(context)),
    vscode.commands.registerCommand("aria.refresh", () => refreshAll(context)),
    vscode.commands.registerCommand("aria.openFinding", (f: Finding) =>
      cmdOpenFinding(f),
    ),
    vscode.commands.registerCommand("aria.openInAria", () => cmdOpenInAria()),
    statusBarItem,
  );

  // Initial load + periodic refresh (findings change via the background scan).
  void refreshAll(context);
  const timer = setInterval(() => void refreshAll(context), REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate(): void {
  // Nothing to clean up beyond the disposables registered in activate().
}
