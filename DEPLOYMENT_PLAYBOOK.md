# Aria — Deployment & Integration Playbook

This file is the operational source of truth for changing and releasing this repository. It describes the workflow that is actually implemented in `package.json` and `.github/workflows/production-check.yml`; it does not depend on a particular preview provider or an old deployment URL.

## Non-negotiable release rules

1. Preserve Aria's product architecture and feature semantics unless a deliberate product change is separately approved.
2. Use Bun and the committed `bun.lock`; do not introduce a second package-manager lockfile.
3. Never commit production secrets.
4. Never hand-edit `src/convex/_generated/*` to make a type error disappear. Regenerate from a configured Convex deployment when codegen is required.
5. Never claim an external integration works solely because TypeScript/build/tests pass.
6. Never merge a release candidate with a failing `Production Check`.
7. Keep global platform administration separate from paid-plan permissions. Team/Enterprise billing must not imply platform-admin access.

## Change workflow

### 1. Install exactly the locked dependency graph

```bash
bun install --frozen-lockfile
```

### 2. Make the smallest correction that solves the verified problem

For backend changes, retain Convex's runtime split: Node-only dependencies belong only in `"use node"` actions. Database access from actions/HTTP handlers goes through generated query/mutation/action calls rather than pretending an action context has direct database access.

### 3. Run the local gate

```bash
bun run verify
```

`verify` executes:

- lint;
- root unit tests;
- VS Code extension typecheck + tests;
- legacy extension typecheck;
- TypeScript project build;
- production Vite bundle.

For a quicker non-build pass during development:

```bash
bun run preflight
```

### 4. Push through CI

`Production Check` runs on pull requests targeting `main` and on pushes to `main`. The hardening branch is also covered while this production-readiness pass is active.

CI uses:

- a pinned Bun version matching `package.json`;
- frozen dependency installs;
- pinned GitHub Action commits;
- read-only repository permissions;
- cancellation of superseded runs on the same ref.

A warning is not automatically a release blocker, but TypeScript errors, build failures, test failures, extension compilation failures, and ESLint errors are blockers.

## Convex generated types

Convex component bindings become fully specific after codegen against a configured deployment. Repository CI intentionally does not require a production Convex deployment secret. The committed generated API therefore permits offline compilation, while the static-hosting component reference in `http.ts` uses a narrow type-only bridge for CI. Runtime routing still uses the official `components.staticHosting` component proxy.

When working in an authenticated Convex development environment, regenerate normally with the Convex CLI rather than editing generated files.

## Environment ownership

### Client build variables

Only intentionally public values use `VITE_`:

```text
VITE_CONVEX_URL
VITE_VAPID_PUBLIC_KEY
```

### Server variables

Secrets and server configuration belong in the target Convex deployment. The complete contract is in `.env.example`. High-value production variables include:

```text
SITE_URL
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
FREEBUFF_EMAIL_API_KEY
OPENROUTER_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ID_PRO
STRIPE_PRICE_ID_PRO_PLUS
STRIPE_PRICE_ID_TEAM
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
```

Do not put server credentials in `VITE_*` variables.

## Security-specific release checks

### GitHub OAuth

- State token is one-time and user-bound.
- Callback traffic is rate limited.
- Token exchange/profile fetch failures are rejected.
- Return origin must match the callback/configured trusted application origins.
- Access token is stored/used backend-side and is not returned by the public connection-status query.

### Stripe

- Webhook signature verification is mandatory.
- Event ids are deduplicated.
- Checkout/portal return URLs come from configured trusted `SITE_URL`.
- Price ids are mapped server-side to application tiers.

### Email OTP

- OTP sends are rate-limited and account lockout remains server-enforced.
- Relay credential comes only from `FREEBUFF_EMAIL_API_KEY`.
- Relay URL must use HTTPS.
- Axios errors must never be stringified with request configuration because headers may contain the relay key.
- Any relay credential previously present in Git history must be rotated before production use.

### Platform administration

Global feature flags, operational error logs, and global health data require the explicit platform `admin` role. A paid subscription is not an administrative authorization mechanism.

### Browser/runtime

- `VITE_CONVEX_URL` is validated before the client starts.
- Production root-error UI does not render stack traces.
- Builder-only toolbar is not rendered on ordinary production hosts.
- iframe message handling is origin/source checked.
- service-worker registration is limited to valid secure contexts (or local development).
- Web Push requires a valid deployment-specific VAPID public key.

## Production deployment

Authenticate the Convex CLI to the intended production project and confirm the target before executing:

```bash
bun install --frozen-lockfile
bun run deploy
```

The deploy script runs the preflight gate and then invokes Convex static hosting with `bun run build` as the production build command.

Do not copy an old development deployment name from documentation and assume it is production. The target must be confirmed from the authenticated Convex project/session at deployment time.

## Post-deploy verification

After deployment, perform the smoke checks in `LAUNCH.md`. At minimum verify:

- app shell + direct routes;
- sign-in;
- GitHub OAuth and a read operation;
- safe test-repository edit/commit/PR flow;
- AI when configured;
- Stripe test-mode lifecycle when enabled;
- email OTP when enabled;
- Web Push when enabled;
- CLI/extension auth surfaces;
- rejection of global admin surfaces for ordinary users.

## Rollback

Record the released Git commit SHA. If a production smoke test fails, fix or revert in source control, obtain a green `Production Check`, and redeploy. Do not make an untracked one-off production patch.

## Known build characteristic

Monaco and its language workers are intentionally substantial assets. The production build currently completes successfully in CI. Large editor/worker chunks are a performance optimization opportunity, not evidence of a failed build; changes to Monaco loading should be treated as product-sensitive because they can alter editor capabilities.

The repository build command gives Vite a 4 GiB Node old-space limit. The locked production bundle exceeds Node's roughly 2 GiB default in some environments, which otherwise aborts the canonical deployment build with a JavaScript heap out-of-memory error even when CI succeeds. Use a build machine with memory available for that heap plus Node, bundler workers, and operating-system overhead. This setting is part of `bun run build`, so `bun run verify` and `bun run deploy` use the same budget without a shell-only override.
