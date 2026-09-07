# Aria for VS Code

A thin VS Code client for the Aria backend — your engineering inbox and
account, right in the editor. It reuses the same **personal access tokens** as
the Aria CLI (created in the web app under **Platform → CLI & API**).

What it does (and what it deliberately does not do):

- **Inbox view** — Aria's background findings (risky dependencies, stale PRs,
  failing CI, suspicious config changes) as a tree in the activity bar.
- **Account view** — who this token is (Aria user + GitHub handle), with
  sign-in/sign-out.
- **Status bar** — `@login` plus an unread-findings count; click to refresh.
- **Open in Aria** — right-click any file in the editor to open Aria in your
  browser (the web app restores your last workspace).
- It does **not** call GitHub directly, does **not** send your code anywhere
  new, and has no access to your GitHub credentials — the token is scoped to
  your Aria account, and the backend enforces that server-side.

## Install & run

```bash
cd extension
bun install          # or: npm install
bunx tsc -p ./       # compile to out/
```

Then press **F5** in VS Code (Extension Development Host) to try it, or
package a `.vsix`:

```bash
bunx @vscode/vsce package
```

## First-time setup

1. Set **Aria: URL** (`aria.url`) in VS Code Settings to the trusted production
   HTTPS origin. There is no built-in production fallback; HTTP is accepted
   only for localhost development.
2. In the Aria web app: **Platform → CLI & API → Create token** (shown once).
3. In VS Code: run **Aria: Sign in (paste access token)** and paste it.
   The token is stored in the OS keychain via VS Code SecretStorage.
4. The Inbox and Account views populate automatically; refresh with
   **Aria: Refresh inbox** or the refresh icon in the view title bar.

## Configuration

| Setting | Default | Purpose |
|---|---|---|
| `aria.url` | *(required)* | Trusted Aria production HTTPS origin |

## Honest limits

- The inbox shows findings (same API family as `/api/cli/repos`,
  `/api/cli/inbox`, `/api/cli/prs` — PRs/issues via `aria prs` in the CLI).
- "Open in Aria" deep-links to the repo + active file via `?repo=&path=`;
  the web app opens exactly that file on its default branch. Set the
  `aria.repo` configuration (e.g. `owner/name`) so the deep link knows which
  repository you're in — the file path is filled automatically from the
  active editor.
