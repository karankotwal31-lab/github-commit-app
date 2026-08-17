# Aria — a quiet desk for your GitHub

Aria is a browser-based GitHub workspace: browse repositories, edit files in a
real code editor (Monaco), stage and commit changes, open pull requests, and
review them — all from one calm, focused interface that works on desktop and
mobile. It resumes your work across devices, keeps an unsaved-draft vault so
nothing is ever trapped in a tab, and includes a grounded AI assistant.

Built with **Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui** on the
frontend and **Convex** (serverless backend + database + auth) on the backend.
Package manager is **Bun**.

## Features

- **Repository workspace** — browse repos and folders, open files in a
  Monaco-based editor with syntax highlighting for 30+ languages.
- **Commit, branch, PR** — stage one file or many, commit atomically, create
  branches, open and merge pull requests (with conflict/draft guards), revert
  commits, delete/rename files.
- **CI status** — a chip on the current branch shows whether the tip build
  passed, failed, or is running, with a per-check breakdown.
- **PR review** — open a pull request and inspect every changed file as a
  unified diff.
- **Full-text code search** — search the whole repo and jump into any result.
- **Issues** — a quick list of open issues for the current repo.
- **Ask Aria (AI)** — a grounded, diff-gated assistant that proposes changes
  against your actual repository. It never commits — it proposes, you review,
  stage, and commit. Multi-turn: follow-ups build on earlier requests.
- **Draft vault** — every unsaved edit is autosaved per (repo, branch, file)
  and resumable from any device, even after the file was closed or the tab was
  killed. Committed files are dropped from the vault automatically.
- **Cross-device continuity** — open Aria on another device and it lands
  exactly where you left off: repo, branch, folder, open file, unsaved edits,
  and caret position.
- **Live presence** — see which of your other devices are in the workspace
  right now and where.
- **Secret guardrails** — committing `.env`, private keys, or live tokens is
  blocked until you explicitly confirm. This applies to manual commits, AI
  proposals, and multi-file batches.
- **Runtime sensing + plugins** — Aria detects the device it runs on
  (desktop/tablet/mobile, OS, browser, connection, capabilities) and
  transparently activates the capabilities it needs. Every plugin ships inside
  Aria's own bundle — nothing is downloaded from third parties at runtime and
  nothing phones home. Open the **Runtime** button in the top bar to see the
  device profile and per-plugin privacy statements.
- **Premium billing (optional)** — a Pro subscription unlocks Ask Aria. Billing
  only activates once Stripe keys are configured; until then everything is
  unlocked.
- **Terminal CLI** — `cli/aria.mjs` is a zero-dependency Node client for the
  `/api/cli/*` endpoints: `aria whoami`, `aria repos`, `aria inbox`, `aria prs`.
  Authenticate with a personal access token from **Platform → CLI & API**.
  See `cli/README.md`.
- **VS Code extension** — `extensions/vscode/` shows your repos, open PRs, and
  inbox in the sidebar, authenticated with the same personal access token
  (stored in VS Code's OS keychain). See `extensions/vscode/README.md`.

## Setup

The project is already wired to a Convex development deployment. To run it
locally:

```bash
bun install
bun run dev        # Vite dev server
bun convex dev     # Convex backend (separate terminal)
```

## Environment keys

Set these in the Freebuff **Keys/API keys** UI (server-side env vars for
Convex actions — never commit them):

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | ✅ | GitHub OAuth app client id |
| `GITHUB_CLIENT_SECRET` | ✅ | GitHub OAuth app secret |
| `OPENROUTER_API_KEY` | For AI | Powers Ask Aria (OpenRouter) |
| `OPENROUTER_MODEL` | Optional | Override the default AI model |
| `STRIPE_SECRET_KEY` | For billing | Stripe server key (sk_live_/sk_test_) |
| `STRIPE_WEBHOOK_SECRET` | For billing | Stripe webhook signing secret |
| `STRIPE_PRICE_ID_PRO` | For Pro | Recurring price for Pro ($12/mo) |
| `STRIPE_PRICE_ID_PRO_PLUS` | For Pro+ | Recurring price for Pro+ ($29/mo) |
| `STRIPE_PRICE_ID_TEAM` | For Team | Per-seat price for Team ($45/seat/mo) |
| `VAPID_PUBLIC_KEY` | For push | Web-push public key (also baked into the client) |
| `VAPID_PRIVATE_KEY` | For push | Web-push signing key (generate, see LAUNCH.md) |

> `STRIPE_PRICE_ID` (legacy) is still honored as the Pro price if
> `STRIPE_PRICE_ID_PRO` is unset — set the new keys and remove the old one
> once migrated.

The GitHub OAuth callback URL to register in your OAuth app is
`{your-site}/api/github/callback`. The Stripe webhook endpoint is
`{your-site}/api/stripe/webhook` (subscribe to `checkout.session.completed`,
`customer.subscription.updated`, and `customer.subscription.deleted`).

`VITE_CONVEX_URL` and the auth keys (JWKS, JWT_PRIVATE_KEY, SITE_URL) are
managed by the platform.

## Architecture

```
Frontend (src/)                  Convex backend (src/convex/)
├─ pages/Dashboard.tsx           ├─ schema.ts          (tables + indexes)
│    logic: state, effects,      ├─ github.ts          (connection, OAuth
│    handlers                     │                      states, workspace,
├─ components/WorkspaceView.tsx   │                      drafts, presence)
│    presentational JSX          ├─ githubActions.ts   (GitHub REST API calls)
├─ components/workspace-shared.tsx ├─ aiActions.ts      (grounded AI proposals)
├─ components/RuntimeDialog.tsx  ├─ billing.ts         (Stripe checkout/plan)
├─ lib/ (runtime, pluginManager, ├─ http.ts            (OAuth + Stripe webhooks)
│    diff, secrets, cursorSync,  └─ auth/              (Convex Auth: OTP +
│    monaco, github)                                     anonymous)
└─ main.tsx (router, providers, OAuth popup bridge)
```

The workspace follows one request pattern: a click in `WorkspaceView` calls a
handler in `Dashboard`, which calls a Convex **action**; the action loads the
user's GitHub token server-side and calls the GitHub REST API; the typed
result flows back and re-renders the view. Cross-device state (workspace
restore, drafts, presence) uses reactive Convex **queries**, so changes appear
on every device automatically.

GitHub OAuth runs in a **popup** (GitHub refuses to render inside the preview
iframe); the callback redirects the popup back to the app, which reports the
result to the opener and closes itself.

## Testing

```bash
bun test
```

Unit tests cover the pure logic: the diff engine (`lib/diff`), secret
guardrails (`lib/secrets`), device detection (`lib/runtime`), and the plugin
manager (`lib/pluginManager`).

## Monetization

Aria ships a five-tier ladder, enforced server-side at the Convex action
layer (never by UI hiding alone):

| Tier | Price | Ask Aria quota | Adds |
| --- | --- | --- | --- |
| Free | $0 | 50 req/mo | Everything core, 1 private repo |
| Pro | $12/mo | 300 req/mo | Unlimited private repos, unified inbox |
| Pro+ | $29/mo | 1,500 req/mo | AI PR descriptions, AI review on push |
| Team | $45/seat/mo | Unlimited | SSO, audit logs, admin console, prorated seats |
| Enterprise | Custom | Unlimited | Self-hosted, custom SLA — contact sales |

Billing is implemented server-side with Stripe (checkout, webhooks, customer
portal). When Stripe keys are absent the app runs fully unlocked; once
configured, quotas and gated features activate automatically. AI usage is
metered per user per calendar month (`aiUsage.ts`) and shown as "X of Y used".
Create a Stripe account and price at <https://dashboard.stripe.com>, then add
the `STRIPE_*` keys above. Full setup steps are in `LAUNCH.md`.
