# Aria — Production Launch Runbook

This runbook covers the parts that can be verified from the repository and the remaining environment-dependent checks required before serving real users. It intentionally does not claim that a deployment is live until the target production URL has been tested.

## 1. Repository gate

A release candidate must pass:

```bash
bun install --frozen-lockfile
bun run verify
```

The GitHub `Production Check` workflow independently runs frozen dependency installation, lint, TypeScript + Vite production build, root tests, legacy-extension typecheck, and current VS Code extension typecheck/tests. Do not deploy a commit whose production check is failing or incomplete.

## 2. Production environment

### Browser build variables

Set for the production frontend build:

```text
VITE_CONVEX_URL=https://YOUR_DEPLOYMENT.convex.cloud
VITE_VAPID_PUBLIC_KEY=YOUR_PUBLIC_VAPID_KEY    # only if push is enabled
```

`VITE_CONVEX_URL` is required. The app renders an explicit configuration error instead of starting with an invalid backend URL.

### Convex server variables

Configure these on the target production Convex deployment, not in committed files:

```text
SITE_URL=https://YOUR_PUBLIC_APP_ORIGIN
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
FREEBUFF_EMAIL_API_KEY=...
OPENROUTER_API_KEY=...                         # if Ask Aria is enabled
STRIPE_SECRET_KEY=...                          # if billing is enabled
STRIPE_WEBHOOK_SECRET=...                      # if billing is enabled
STRIPE_PRICE_ID_PRO=...
STRIPE_PRICE_ID_PRO_PLUS=...
STRIPE_PRICE_ID_TEAM=...
VAPID_PUBLIC_KEY=...                           # if push is enabled
VAPID_PRIVATE_KEY=...                          # if push is enabled
```

Optional variables and legacy fallbacks are listed in `.env.example`.

### Important key rules

- Never commit secrets or paste production credentials into source files.
- `VAPID_PUBLIC_KEY` and `VITE_VAPID_PUBLIC_KEY` must be the same public key.
- `SITE_URL` must be the exact production HTTPS origin.
- A credential that has previously appeared in Git history must be rotated before production. Removing it from the current file does not invalidate the old value.
- The OTP relay key is now environment-only (`FREEBUFF_EMAIL_API_KEY`).

## 3. GitHub OAuth App

Configure the GitHub OAuth App with the production application URL and this exact callback path:

```text
https://YOUR_PUBLIC_APP_ORIGIN/api/github/callback
```

The callback implementation:

- requires a one-time state token bound to the signed-in user;
- rate-limits unauthenticated callback traffic;
- validates the token-exchange response and GitHub profile;
- keeps the GitHub access token on the backend;
- only redirects to an origin that matches the callback origin or a configured application origin.

## 4. Stripe

When billing is enabled, create recurring Stripe Prices for the tiers represented by the application and configure their Price ids in the production Convex environment.

Create the webhook at:

```text
https://YOUR_PUBLIC_APP_ORIGIN/api/stripe/webhook
```

Subscribe it to:

```text
checkout.session.completed
customer.subscription.updated
customer.subscription.deleted
```

The backend verifies the Stripe signature and maintains an event-deduplication record before treating subscription events as authoritative.

Test with Stripe test-mode keys and prices before switching to live credentials.

## 5. Email OTP

Email OTP delivery requires `FREEBUFF_EMAIL_API_KEY`. `FREEBUFF_EMAIL_API_URL` is optional and defaults to the configured HTTPS relay used by the application.

The application does not contain a relay credential in source. Relay/network failures are converted to a user-safe error and the Axios request configuration is not stringified, preventing the API key from being copied into UI/log error payloads.

Before launch:

1. rotate any relay credential that was previously committed;
2. put the replacement value only in the production Convex environment;
3. perform a real OTP request against the production deployment;
4. verify rate limiting and lockout behavior using non-production/test accounts.

## 6. Web Push

Push is optional. If enabled, configure a matching VAPID keypair and build the browser with its public key. The browser considers push unsupported when the key is missing/invalid or when the page is not in a secure context.

After deployment, test subscription creation, notification delivery, dead-subscription pruning, and notification navigation on at least one supported desktop browser and one supported mobile browser.

## 7. Deploy

From a machine/session authenticated to the intended production Convex project:

```bash
bun install --frozen-lockfile
bun run deploy
```

The command runs the repository preflight checks and then calls `@convex-dev/static-hosting deploy` with `bun run build` as the production build command. The hosting tool deploys the Convex application and publishes the built frontend for that target deployment.

Before running it, verify the Convex CLI is pointed at the intended production project. Do not infer the target from an old URL in documentation or a development preview.

## 8. Mandatory post-deploy smoke test

A successful build is not sufficient. Test the actual production URL:

- Root page loads without a configuration/runtime error.
- Direct navigation to `/auth`, `/dashboard`, `/privacy`, `/terms`, and an unknown route behaves as expected.
- Fresh/incognito sign-in succeeds.
- GitHub connect flow completes and returns to the same trusted production origin.
- Repository list and a file read work for the connected GitHub account.
- A non-destructive edit/draft workflow can be created and recovered.
- A test commit/branch/PR workflow behaves as designed on a disposable test repository.
- Ask Aria returns grounded output when its provider is configured.
- Stripe test checkout, portal return, webhook update, and cancellation update work when billing is enabled.
- Web Push subscription/delivery works when push is enabled.
- CLI token authentication returns the expected user-scoped data.
- VS Code extension can authenticate with a test Aria token and load its read surfaces.
- Browser console has no uncaught production runtime error.
- Admin-only operational surfaces reject a normal paid/non-admin account.

## 9. Release rollback rule

If a production smoke test fails, do not patch directly on the deployment without source control. Revert/fix in Git, let `Production Check` pass, and redeploy the known-good commit. Keep the last known-good commit SHA with the release record so rollback is deterministic.

## 10. What repository CI cannot prove

The repository can fully validate source compilation, bundling, unit behavior, extension compilation/tests, and static configuration. CI without production secrets cannot prove that external credentials, OAuth registration, Stripe configuration, email delivery, AI-provider availability, DNS, or Web Push delivery are correct. Those are launch-time integration checks and must be verified against the real target deployment.
