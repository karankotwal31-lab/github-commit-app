# Aria — a quiet desk for your GitHub

Aria is a browser-based GitHub workspace for browsing repositories, editing files in Monaco, staging and committing changes, opening and reviewing pull requests, and continuing work across devices. The existing product architecture is React/Vite on the client and Convex for backend functions, data, authentication, scheduled work, and static hosting.

## Core capabilities

- Repository and file browsing with a Monaco-based editor.
- Branch, commit, pull-request, history, conflict-resolution, stash, rebase, cherry-pick, and local Git workflows.
- GitHub OAuth with the OAuth token kept server-side.
- CI/check status, issues, inbox, code search, and PR review.
- Ask Aria with repository-grounded context and review-before-commit behavior.
- Draft recovery, cross-device workspace state, offline reconciliation, and presence.
- Secret/unsafe-commit guardrails and server-side rate limiting.
- Stripe-backed paid plans when billing is configured.
- Web Push notifications when a matching VAPID keypair is configured.
- CLI and VS Code extension surfaces backed by scoped Aria API tokens.

## Toolchain

- React 19 + TypeScript + Vite 7
- Tailwind CSS 4 + shadcn/Radix UI
- Convex + Convex Auth + `@convex-dev/static-hosting`
- Bun 1.3.14 (the canonical package manager for this repository)

Do not generate or commit an npm lockfile. `bun.lock` is the dependency lock used by CI and deployment verification.

## Local development

Create a local `.env.local` from `.env.example`, configure a Convex development deployment, then run:

```bash
bun install --frozen-lockfile
bunx convex dev
```

In a second terminal:

```bash
bun run dev
```

The frontend refuses to boot with an invalid or missing `VITE_CONVEX_URL`, rather than silently connecting to an unintended backend.

## Environment contract

### Browser-visible build variables

These are intentionally exposed to the Vite bundle:

| Variable | Purpose |
| --- | --- |
| `VITE_CONVEX_URL` | Convex deployment URL used by the browser |
| `VITE_VAPID_PUBLIC_KEY` | Web Push public key; required only when push is enabled |

### Server-only Convex variables

Configure these in the target Convex deployment. Never commit real values and never expose them through a `VITE_` variable.

| Variable | Required for | Notes |
| --- | --- | --- |
| `SITE_URL` | Production | Canonical HTTPS app origin used for trusted redirects and billing return URLs |
| `GITHUB_CLIENT_ID` | GitHub OAuth | GitHub OAuth App client id |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth | GitHub OAuth App secret |
| `FREEBUFF_EMAIL_API_KEY` | Email OTP | OTP relay credential; no credential is stored in source code |
| `FREEBUFF_EMAIL_API_URL` | Optional | Override for the OTP relay URL; HTTPS only |
| `OPENROUTER_API_KEY` | Ask Aria | Primary AI provider key |
| `OPENROUTER_MODEL` | Optional | Model override |
| `STRIPE_SECRET_KEY` | Billing | Stripe server secret |
| `STRIPE_WEBHOOK_SECRET` | Billing | Webhook signature secret |
| `STRIPE_PRICE_ID_PRO` | Pro checkout | Recurring Stripe Price id |
| `STRIPE_PRICE_ID_PRO_PLUS` | Pro+ checkout | Recurring Stripe Price id |
| `STRIPE_PRICE_ID_TEAM` | Team checkout | Per-seat Stripe Price id |
| `VAPID_PUBLIC_KEY` | Web Push | Must exactly match `VITE_VAPID_PUBLIC_KEY` |
| `VAPID_PRIVATE_KEY` | Web Push | Server-side signing key |

`STRIPE_PRICE_ID` remains supported only as a legacy Pro-price fallback. Optional integrations such as Resend, Airbrake, and PostHog are documented in `.env.example`.

The GitHub OAuth callback is:

```text
https://YOUR_PRODUCTION_ORIGIN/api/github/callback
```

The Stripe webhook endpoint is:

```text
https://YOUR_PRODUCTION_ORIGIN/api/stripe/webhook
```

Subscribe Stripe to `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.

## Verification

The repository has one reproducible verification gate:

```bash
bun run verify
```

It runs lint, the root unit suite, both extension typechecks/tests, TypeScript compilation, and a real production Vite build. GitHub Actions runs the same production-critical stages for pull requests and for pushes to `main`.

For quick local validation without a production build:

```bash
bun run preflight
```

## Production deployment

After the target Convex production deployment and environment variables are configured:

```bash
bun install --frozen-lockfile
bun run deploy
```

`bun run deploy` first executes the non-build preflight gate and then invokes `@convex-dev/static-hosting` with `bun run build` as its production build command. The static-hosting deployment publishes the Convex backend and the built `dist/` frontend to the target Convex deployment.

Do not treat a successful repository build as proof that GitHub OAuth, Stripe, email delivery, AI, or Web Push credentials are valid. Those integrations require a post-deploy smoke test against the actual production deployment. See `LAUNCH.md`.

## Security notes

- GitHub OAuth tokens remain in backend storage and are not returned to browser-facing connection queries.
- CLI tokens are verified from hashes rather than stored raw for lookup.
- OAuth return origins are allowlisted against configured application origins.
- Stripe webhooks are signature-verified and deduplicated.
- Global operational/admin controls require the explicit platform `admin` role; purchasing a paid plan does not grant platform-admin access.
- Production error UI hides stack traces; optional telemetry is sanitized.
- The OTP relay credential is environment-only. If a credential has ever been committed to Git history, rotate it before production use even after removing it from the current tree.

## Repository layout

```text
src/                     React/Vite application
src/convex/              Convex backend, auth, GitHub, billing, AI, crons
src/lib/                 Git/diff/security/runtime client logic
cli/                     Aria CLI
extension/               Legacy extension surface
extensions/vscode/       Current VS Code extension
public/                  PWA/static assets
.github/workflows/       Production verification CI
```

The architecture and feature model are intentionally preserved; production hardening should fix correctness, security, reliability, and deployment issues without redesigning the product.
