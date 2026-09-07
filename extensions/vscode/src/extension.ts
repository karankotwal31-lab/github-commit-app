import * as vscode from "vscode";
import {
  AriaApi,
  AriaApiError,
  DEFAULT_SITE,
  PrDetail,
  WhoamiData,
} from "./api";
import {
  InboxProvider,
  PrFilesProvider,
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
  const prFilesProvider = new PrFilesProvider(api, tokenProvider);
  const inboxProvider = new InboxProvider(api, tokenProvider);

  context.subscriptions.push(
    vscode.window.createTreeView("ariaRepos", {
      treeDataProvider: reposProvider,
    }),
    vscode.window.createTreeView("ariaPrs", {
      treeDataProvider: prsProvider,
    }),
    vscode.window.createTreeView("ariaPrFiles", {
      treeDataProvider: prFilesProvider,
    }),
    vscode.window.createTreeView("ariaInbox", {
      treeDataProvider: inboxProvider,
    }),
  );

  // --- Inline diff review ------------------------------------------------
  // Virtual documents under the `aria-diff:` scheme. The cache is populated
  // when a PR is loaded; VS Code's `vscode.diff` renders a real two-pane
  // editor diff from these without a local checkout.
  const diffCache = new Map<string, string>();
  const diffDocProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return diffCache.get(uri.toString()) ?? "";
    },
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("aria-diff", diffDocProvider),
  );

  function diffUri(
    side: "old" | "new",
    detail: PrDetail,
    filename: string,
  ): vscode.Uri {
    const path = `/${side}/${detail.repo
      .split("/")
      .map(encodeURIComponent)
      .join("/")}/${detail.number}/${filename
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    return vscode.Uri.from({ scheme: "aria-diff", path });
  }

  async function reviewPr(repo: string, number: number): Promise<void> {
    const token = await tokenProvider.getToken();
    if (!token) {
      void vscode.window.showInformationMessage(
        "Aria is not connected. Run “Aria: Sign in” first.",
      );
      return;
    }
    try {
      const detail = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Aria: loading PR #${number}…`,
        },
        () => api.prDetail(repo, number, token),
      );
      diffCache.clear();
      for (const f of detail.files) {
        if (f.oldContent !== null) {
          diffCache.set(diffUri("old", detail, f.filename).toString(), f.oldContent);
        }
        if (f.newContent !== null) {
          diffCache.set(diffUri("new", detail, f.filename).toString(), f.newContent);
        }
      }
      prFilesProvider.setDetail(detail);
      const totals = detail.files.reduce(
        (acc, f) => ({
          additions: acc.additions + f.additions,
          deletions: acc.deletions + f.deletions,
        }),
        { additions: 0, deletions: 0 },
      );
      void vscode.window.showInformationMessage(
        `PR #${detail.number} — ${detail.title} (+${totals.additions} −${totals.deletions}, ${detail.files.length} file${detail.files.length === 1 ? "" : "s"})`,
      );
    } catch (err) {
      void vscode.window.showErrorMessage(messageOf(err));
    }
  }

  async function reviewFile(filename: string): Promise<void> {
    const detail = prFilesProvider.getDetail();
    if (!detail) return;
    const file = detail.files.find((f) => f.filename === filename);
    if (!file) return;
    const oldUri = diffUri("old", detail, filename);
    const newUri = diffUri("new", detail, filename);
    const title = `${filename} — PR #${detail.number}`;
    await vscode.commands.executeCommand("vscode.diff", oldUri, newUri, title);
  }

  const refreshAll = async (): Promise<void> => {
    reposProvider.refresh();
    prsProvider.refresh();
    inboxProvider.refresh();
    await refreshStatus();
  };

  const refreshStatus = async (): Promise<void> => {
    if (!api.site) {
      statusItem.text = "$(gear) Aria: configure URL";
      statusItem.tooltip = "Set aria.siteUrl to the trusted production HTTPS origin";
      statusItem.command = "workbench.action.openSettings";
      statusItem.show();
      return;
    }
    const token = await tokenProvider.getToken();
    if (!token) {
      statusItem.text = "$(key) Aria: not connected";
      statusItem.tooltip = "Run the “Aria: Sign in” command";
      statusItem.command = "aria.whoami";
      statusItem.show();
      return;
    }
    try {
      const data = await api.whoami(token);
      const login = data.github?.login ?? data.user?.name ?? "connected";
      statusItem.text = `$(check) Aria: ${login}`;
      statusItem.tooltip = "Aria — click for details";
      statusItem.command = "aria.whoami";
    } catch (err) {
      const message = messageOf(err);
      statusItem.text = /not configured|invalid|must use HTTPS/i.test(message)
        ? "$(gear) Aria: configure URL"
        : "$(warning) Aria: re-auth needed";
      statusItem.tooltip = message;
    }
    statusItem.show();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("aria.login", async () => {
      if (!api.site) {
        void vscode.window.showErrorMessage(
          "Configure aria.siteUrl in VS Code Settings before signing in.",
        );
        return;
      }
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
      if (!api.site) {
        void vscode.window.showErrorMessage(
          "Configure aria.siteUrl in VS Code Settings first.",
        );
        return;
      }
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

    vscode.commands.registerCommand("aria.openApp", () => {
      if (!api.site) {
        void vscode.window.showErrorMessage(
          "Configure aria.siteUrl in VS Code Settings first.",
        );
        return;
      }
      try {
        const parsed = new URL(api.site);
        const local =
          parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
        if (parsed.protocol !== "https:" && !local) {
          throw new Error("Aria backend URL must use HTTPS outside local development.");
        }
        void vscode.env.openExternal(vscode.Uri.parse(api.site));
      } catch (err) {
        void vscode.window.showErrorMessage(messageOf(err));
      }
    }),

    vscode.commands.registerCommand("aria.reviewPr", (repo?: string, number?: number) => {
      if (typeof repo === "string" && typeof number === "number") {
        void reviewPr(repo, number);
      }
    }),

    vscode.commands.registerCommand("aria.reviewFile", (filename?: string) => {
      if (typeof filename === "string") {
        void reviewFile(filename);
      }
    }),

    vscode.commands.registerCommand("aria.openPrOnGithub", (row?: { url?: string }) => {
      if (row?.url) {
        void vscode.env.openExternal(vscode.Uri.parse(row.url));
      }
    }),

    vscode.commands.registerCommand("aria.openUrl", (url?: string) => {
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("aria.siteUrl")) return;
      const nextSite =
        vscode.workspace
          .getConfiguration("aria")
          .get<string>("siteUrl", DEFAULT_SITE) ?? DEFAULT_SITE;
      api.setSite(nextSite);
      void refreshAll();
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
