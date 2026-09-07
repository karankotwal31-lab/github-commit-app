# Aria for VS Code

Your Aria workspace — connected repositories, open pull requests, and the
unified inbox — right in the editor sidebar.

This extension authenticates with the **same personal access token as the
Aria CLI** and talks to the same read-only `/api/cli/*` endpoints. It never
touches your GitHub OAuth token, it never writes to GitHub, and your token
is kept in VS Code's secure secret storage (OS keychain), not in a file.

## Install

**From source (this repo):**

```bash
cd extensions/vscode
bun install
bun run compile
```

Then press **F5** in VS Code with this folder open to launch an Extension
Development Host, or package a VSIX:

```bash
bunx @vscode/vsce package --no-dependencies
code --install-extension aria-vscode-0.1.0.vsix
```

## First-time setup

1. Set **Aria: Site Url** (`aria.siteUrl`) in VS Code Settings to the trusted
   production HTTPS origin. There is intentionally no hardcoded production
   fallback; HTTP is accepted only for localhost development.
2. Open the Aria web app and sign in.
3. Go to **Platform → CLI & API → Create token**.
4. Copy the token — it is shown exactly once and starts with `aria_`.
5. Run **Aria: Sign in** in VS Code and paste the token.

The token is scoped to *your* account. Revoke it anytime from the same
screen; revoked tokens are rejected immediately, including here.

## Use

| Action | How |
| --- | --- |
| Sign in | Command Palette → **Aria: Sign in** (or click the "Sign in to Aria" row in any Aria view) |
| See your identity | **Aria: Who am I** — also shown in the status bar as `Aria: <login>` |
| Repositories | **Aria** activity-bar icon → *Repositories* view |
| Pull requests | *Pull Requests* view — click a PR to load it into the *Review* view |
| Inline diff review | *Review* view lists the PR's changed files — click a file for a real two-pane editor diff (`+a −d` counts, status icons) |
| Inbox | *Inbox* view — unread items are marked with `●`; click to open the source |
| Refresh | **Aria: Refresh** (re-fetches all four views) |
| Sign out | **Aria: Sign out** (removes the token from this machine only) |
| Web app | **Aria: Open web app** |

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `aria.siteUrl` | *(required)* | Trusted Aria production HTTPS origin |

Changing `aria.siteUrl` takes effect immediately for the shared API client and
all extension views.

## Security notes

- The token lives in **VS Code SecretStorage** (OS keychain), never in a
  project file or the workspace.
- Only the **SHA-256 hash** of your token exists server-side; the plaintext
  is returned once, at creation.
- Every response is scoped server-side to the token's owner.
- Remote Aria origins must use HTTPS; only localhost may use HTTP.
- The extension is **read-only by design** — it can inspect, never modify.

## Development

- `src/api.ts` — pure HTTP client for `/api/cli/*` (no `vscode` imports),
  covered by unit tests.
- `src/views.ts` — the tree data providers.
- `src/extension.ts` — activation, commands, secret storage, status bar.

Run the tests from the repo root (Bun):

```bash
bun test extensions/vscode/src/api.test.ts
```

Typecheck the extension standalone:

```bash
cd extensions/vscode && ./node_modules/.bin/tsc -p . --noEmit
```

The server side lives in `src/convex/cli.ts` (tokens + data) and
`src/convex/http.ts` (the `/api/cli/*` routes).
