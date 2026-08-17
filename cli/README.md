# Aria CLI

The terminal front door to your Aria workspace. A single, zero-dependency
Node.js file (`aria.mjs`) that talks to the read-only HTTP endpoints your
Aria deployment already exposes (`/api/cli/*`).

It answers the "no CLI" critique directly: you get `whoami`, `repos`,
`inbox`, and `prs` from the terminal — without installing anything, and
without ever handing your GitHub OAuth token to a script.

## What you need

- **Node.js 18+** (global `fetch` is required; no packages are installed).
- An **Aria personal access token**, created in the web app:
  **Platform → CLI & API → Create token**. The token is shown exactly once,
  starts with `aria_`, and is scoped to *your* account only.

## Install

```bash
# Option A — alias (no install):
alias aria="node /path/to/aria/cli/aria.mjs"

# Option B — link as a global command (from the cli/ directory):
cd cli && npm link
aria --version
```

## Login

```bash
aria login <token>          # stored in ~/.aria/config.json (chmod 600)
aria login                  # same, but prompts for the token
```

You can skip storing a token per-machine with the environment:

```bash
export ARIA_TOKEN="aria_…"  # env overrides the config file
export ARIA_SITE="https://your-site.convex.site"   # only if self-hosting elsewhere
```

## Commands

| Command | What it shows |
| --- | --- |
| `aria whoami` | Your Aria identity + connected GitHub account |
| `aria repos` | Your connected repositories (private marked) |
| `aria inbox` | Unified inbox — findings newest first, `[new]` for unread |
| `aria prs` | Open pull requests across your repos, newest first |
| `aria open` | Print the web app URL |
| `aria help` | Full help text |
| `aria --version` | Version |

Every data command supports `--json` for scripts:

```bash
aria prs --json | jq '.[] | select(.draft == false)'
```

## How it's secured

- Tokens are stored with owner-only permissions (`0600`).
- Only the **SHA-256 hash** of your token exists on the server — the
  plaintext is returned once, at creation, and is never retrievable again.
- Every request is scoped server-side to the user the token belongs to.
- Revoke a token at any time in **Platform → CLI & API**; revoked tokens
  are rejected immediately.
- The CLI is **read-only by design**: it can inspect your repos and inbox,
  but it cannot change anything on GitHub.

## Development

The client is plain ESM with no dependencies. Tests run with Bun:

```bash
bun test cli/aria.test.ts
```

The server side lives in `src/convex/cli.ts` (tokens + data) and
`src/convex/http.ts` (the `/api/cli/*` routes).
