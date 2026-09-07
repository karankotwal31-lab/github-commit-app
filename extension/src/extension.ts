import * as vscode from "vscode";
import {
  apiFromConfig,
  clearToken,
  getStoredToken,
  storeToken,
  type InboxItem,
  type Whoami,
} from "./api";
import { InboxProvider } from "./inboxProvider";
import { AccountProvider } from "./accountProvider";

let statusBar: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  let api = apiFromConfig();
  const inboxProvider = new InboxProvider();
  const accountProvider = new AccountProvider();

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.command = "aria.refresh";
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("aria.inbox", inboxProvider),
    vscode.window.registerTreeDataProvider("aria.account", accountProvider),
  );

  const refresh = async () => {
    const token = await getStoredToken(context);
    if (!token) {
      statusBar.text = "$(account) Aria: sign in";
      statusBar.tooltip = "Aria: Sign in (paste access token)";
      statusBar.command = "aria.signIn";
      inboxProvider.refresh([]);
      accountProvider.refresh(null, false);
      return;
    }
    statusBar.text = "$(sync~spin) Aria: syncing";
    statusBar.command = "aria.refresh";
    try {
      const [whoami, inbox] = await Promise.all([
        api.request<Whoami>(token, "/api/cli/whoami"),
        api.request<InboxItem[]>(token, "/api/cli/inbox"),
      ]);
      const unread = inbox.filter((i) => !i.read).length;
      statusBar.text =
        unread > 0
          ? `$(bell-dot) Aria: ${unread}`
          : "$(check) Aria: all clear";
      statusBar.tooltip =
        unread > 0
          ? `${unread} unread finding${unread === 1 ? "" : "s"} — click to refresh`
          : "Inbox is clear — click to refresh";
      inboxProvider.refresh(inbox);
      accountProvider.refresh(whoami, true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      statusBar.text = /not configured|invalid/i.test(message)
        ? "$(gear) Aria: configure URL"
        : "$(warning) Aria";
      statusBar.tooltip = message;
      if (/sign in again/i.test(message)) {
        await clearToken(context);
        statusBar.command = "aria.signIn";
      }
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("aria.signIn", async () => {
      const token = await vscode.window.showInputBox({
        prompt:
          "Paste your Aria personal access token (web app → Platform → CLI & API).",
        password: true,
        ignoreFocusOut: true,
      });
      if (!token?.trim()) return;
      await storeToken(context, token.trim());
      await refresh();
      vscode.window.showInformationMessage("Aria: signed in.");
    }),
    vscode.commands.registerCommand("aria.signOut", async () => {
      await clearToken(context);
      await refresh();
      vscode.window.showInformationMessage("Aria: signed out.");
    }),
    vscode.commands.registerCommand("aria.refresh", () => refresh()),
    vscode.commands.registerCommand("aria.openInAria", async (uri?: vscode.Uri) => {
      const file = uri ?? vscode.window.activeTextEditor?.document.uri;
      const repo = vscode.workspace
        .getConfiguration("aria")
        .get<string>("repo", "");
      const rawUrl =
        vscode.workspace.getConfiguration("aria").get<string>("url", "") ?? "";
      const url = rawUrl.trim().replace(/\/+$/, "");
      if (!url) {
        void vscode.window.showErrorMessage(
          "Aria backend URL is not configured. Set aria.url in VS Code Settings first.",
        );
        return;
      }
      try {
        const parsed = new URL(url);
        const local =
          parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
        if (parsed.protocol !== "https:" && !local) {
          throw new Error("Aria backend URL must use HTTPS outside local development.");
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          error instanceof Error
            ? error.message
            : "Aria backend URL is invalid. Update aria.url in VS Code Settings.",
        );
        return;
      }
      const params = new URLSearchParams();
      if (repo) params.set("repo", repo);
      if (file && file.scheme === "file") {
        const rel = vscode.workspace.asRelativePath(file, false);
        if (rel && !rel.startsWith("..")) params.set("path", rel);
      }
      await vscode.env.openExternal(
        vscode.Uri.parse(`${url}/dashboard?${params.toString()}`),
      );
    }),
  );

  // Refresh on activation, on config change, and every 5 minutes so the
  // inbox stays warm without hammering the backend.
  await refresh();
  const timer = setInterval(() => void refresh(), 5 * 60_000);
  context.subscriptions.push(
    new vscode.Disposable(() => clearInterval(timer)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("aria.url")) {
        api = apiFromConfig();
        void refresh();
      }
    }),
  );
}

export function deactivate() {}
