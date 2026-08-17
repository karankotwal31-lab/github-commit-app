import * as vscode from "vscode";
import {
  AriaApi,
  AriaApiError,
  DEFAULT_SITE,
  WhoamiData,
} from "./api";
import {
  InboxProvider,
  PrsProvider,
  ReposProvider,
  TokenProvider,
} from "./views";

const TOKEN_SECRET_KEY = "aria.token";

class SecretTokenProvider implements TokenProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async getToken(): Promise<string | null> {
    const token = await this.context.secrets.get(TOKEN_SECRET_KEY);
    return token && token.length > 0 ? token : null;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const configuredSite =
    vscode.workspace
      .getConfiguration("aria")
      .get<string>("siteUrl", DEFAULT_SITE) ?? DEFAULT_SITE;
  const api = new AriaApi(configuredSite);
  const tokenProvider = new SecretTokenProvider(context);

  // Status bar chip: "Aria: <login>" once authenticated.
  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusItem.command = "aria.whoami";
  context.subscriptions.push(statusItem);

  const reposProvider = new ReposProvider(api, tokenProvider);
  const prsProvider = new PrsProvider(api, tokenProvider);
  const inboxProvider = new InboxProvider(api, tokenProvider);

  context.subscriptions.push(
    vscode.window.createTreeView("ariaRepos", {
      treeDataProvider: reposProvider,
    }),
    vscode.window.createTreeView("ariaPrs", {
      treeDataProvider: prsProvider,
    }),
    vscode.window.createTreeView("ariaInbox", {
      treeDataProvider: inboxProvider,
    }),
  );

  const refreshAll = async (): Promise<void> => {
    reposProvider.refresh();
    prsProvider.refresh();
    inboxProvider.refresh();
    await refreshStatus();
  };

  const refreshStatus = async (): Promise<void> => {
    const token = await tokenProvider.getToken();
    if (!token) {
      statusItem.text = "$(key) Aria: not connected";
      statusItem.tooltip = "Run the “Aria: Sign in” command";
      statusItem.show();
      return;
    }
    try {
      const data = await api.whoami(token);
      const login = data.github?.login ?? data.user?.name ?? "connected";
      statusItem.text = `$(check) Aria: ${login}`;
      statusItem.tooltip = "Aria — click for details";
    } catch {
      statusItem.text = "$(warning) Aria: re-auth needed";
      statusItem.tooltip = "Your token may be revoked — run “Aria: Sign in”";
    }
    statusItem.show();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("aria.login", async () => {
      const token = await vscode.window.showInputBox({
        title: "Aria: Sign in",
        prompt: "Paste your Aria personal access token (aria_…)",
        placeHolder: "aria_…",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) =>
          value && value.trim().startsWith("aria_")
            ? undefined
            : "Tokens start with “aria_” — create one in the web app under Platform → CLI & API.",
      });
      if (!token) return;
      await context.secrets.store(TOKEN_SECRET_KEY, token.trim());
      await refreshAll();
      void vscode.window.showInformationMessage("Aria: signed in.");
    }),

    vscode.commands.registerCommand("aria.logout", async () => {
      await context.secrets.delete(TOKEN_SECRET_KEY);
      await refreshAll();
      void vscode.window.showInformationMessage(
        "Aria: signed out. Your token is only revoked server-side if you do it in the web app.",
      );
    }),

    vscode.commands.registerCommand("aria.whoami", async () => {
      const token = await tokenProvider.getToken();
      if (!token) {
        void vscode.window.showInformationMessage(
          "Aria is not connected. Run “Aria: Sign in”.",
        );
        return;
      }
      try {
        const data: WhoamiData = await api.whoami(token);
        const lines = [
          data.user?.name
            ? `Aria user: ${data.user.name}`
            : "Aria user: (unnamed)",
        ];
        if (data.github) {
          lines.push(
            `GitHub: ${data.github.login}${data.github.name ? ` (${data.github.name})` : ""}`,
          );
        } else {
          lines.push("GitHub: not connected");
        }
        void vscode.window.showInformationMessage(lines.join("\n"), {
          modal: false,
        });
      } catch (err) {
        void vscode.window.showErrorMessage(messageOf(err));
      }
    }),

    vscode.commands.registerCommand("aria.refresh", () => refreshAll()),

    vscode.commands.registerCommand("aria.openApp", () =>
      vscode.env.openExternal(vscode.Uri.parse(api.site)),
    ),

    vscode.commands.registerCommand("aria.openUrl", (url?: string) => {
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }),
  );

  void refreshStatus();
}

function messageOf(err: unknown): string {
  if (err instanceof AriaApiError || err instanceof Error) return err.message;
  return String(err);
}

export function deactivate(): void {
  // Nothing to tear down — subscriptions are disposed by VS Code.
}
