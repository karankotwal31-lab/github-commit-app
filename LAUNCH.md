# Aria — Production Launch Runbook

Aria is **fully serverless** — there is no dedicated server to buy or maintain.
The "backend" is Convex (managed cloud: serverless functions + database + auth),
which has a generous free tier. Your real costs are: a domain (~$10/yr) and
Stripe's ~2.9% + $0.30 per successful charge.

Total expected out-of-pocket to launch: **under $20** (domain + optional email).

---

## 0. What's already in place (no work needed)

| Area | Status |
|---|---|
| Backend / database / auth | Convex cloud (managed) |
| GitHub OAuth (popup flow) | Wired via Convex Auth |
| Billing (Stripe) | 5-tier ladder, server-side gated |
| Legal pages | `/privacy`, `/terms` (wired in the footer) |
| LICENSE | Proprietary, Aria Labs, all rights reserved |
| Web push notifications | 24×7 cron + open-app polling |
| SEO basics | `index.html` meta, `public/robots.txt` |
| Deployment config | `convex.json` (hosting config block) |

---

## 1. Environment variables (do this first)

Set these in the **Keys / API keys** UI of your hosting dashboard
(never in `.env` files — they're git-ignored and not deployed):

| Variable | Where to get it | Required for |
|---|---|---|
| `GITHUB_CLIENT_ID` | GitHub → Settings → Developer settings → OAuth Apps | Sign-in with GitHub |
| `GITHUB_CLIENT_SECRET` | same OAuth App | Sign-in with GitHub |
| `OPENROUTER_API_KEY` | openrouter.ai (free tier exists) | "Ask Aria" AI |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys | Checkout & billing |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks (after step 3) | Subscription events |
| `STRIPE_PRICE_ID_PRO` | Stripe → Products (after step 3) | Pro price ($12/mo) |
| `STRIPE_PRICE_ID_PRO_PLUS` | Stripe → Products (after step 3) | Pro+ price ($29/mo) |
| `STRIPE_PRICE_ID_TEAM` | Stripe → Products (after step 3) | Team price ($45/seat/mo) |
| `VAPID_PUBLIC_KEY` | Already baked into the client — set it here too | Web push (public half of the keypair) |
| `VAPID_PRIVATE_KEY` | See LAUNCH.md §5 (generated keypair) | Web push signing |

> `STRIPE_PRICE_ID` (legacy) is still honored as the Pro price if
> `STRIPE_PRICE_ID_PRO` is unset — set the new keys and remove the old one
> once migration is done.

Managed automatically by the platform (do **not** set these):
`VLY_APP_NAME`, `VLY_CONVEX_AUTH_ISSUER`.

---

## 2. GitHub OAuth app

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App.
2. Homepage URL: your production URL (e.g. `https://aria.yourdomain.com`).
3. Authorization callback URL: `https://<your-convex-site>.convex.site/auth/callback`
   (find this in the Convex dashboard after first deploy).
4. Copy the Client ID + Client Secret into the env vars above.
5. In the GitHub OAuth App settings, add your local dev URL as an extra
   callback for testing (`http://localhost:5173/auth/callback`).

---

## 3. Stripe setup (5-tier ladder)

1. Create one product per paid tier, each with a recurring monthly price:
   - **Aria Pro** — $12/mo → `STRIPE_PRICE_ID_PRO`
   - **Aria Pro+** — $29/mo → `STRIPE_PRICE_ID_PRO_PLUS`
   - **Aria Team** — $45/seat/mo (per-seat, metered quantity) → `STRIPE_PRICE_ID_TEAM`
2. Copy each Price ID into its env var above.
3. Deploy once (step 4), then create a webhook endpoint:
   - URL: `https://<your-convex-site>.convex.site/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`
4. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Switch to **live mode** and repeat with live keys when ready to take money.

How the ladder is enforced (all server-side, never UI-hidden):

| Tier | Price | Ask Aria quota / mo | Notes |
|---|---|---|---|
| Free | $0 | 50 | 1 private repo (tracked, see repo limits) |
| Pro | $12/mo | 300 | Unlimited private repos, unified inbox |
| Pro+ | $29/mo | 1,500 | AI review on push, AI PR descriptions |
| Team | $45/seat/mo | Unlimited | SSO, audit logs, admin console; prorated seats |
| Enterprise | Custom | Unlimited | Self-hosted option, custom SLA — contact sales |

Quota is enforced in the `aiSuggest` action (check before, meter after), and
usage shows as "X of Y used" in the billing dialog and the Ask Aria panel.
Team seat changes are prorated automatically via `updateTeamSeats` (Stripe).

---

## 4. Deploy

```bash
# 1. Push the backend + database schema + auth config
bunx convex deploy

# 2. Deploy the static frontend to your host (Netlify / Vercel / Cloudflare Pages)
bun run build          # outputs dist/
# then point your host at dist/ with an SPA fallback to /index.html
```

> **Build memory:** Aria bundles Monaco (large editor) — the production build
> needs **≥ 4 GB RAM** on the CI/build machine. Netlify/Vercel/Cloudflare free
> tiers provide this; very small containers (~2 GB) can OOM during `vite build`.

Every host below is free-tier-viable:

| Host | Free tier | Notes |
|---|---|---|
| Netlify | Yes | One-click, SPA redirect rule built-in |
| Vercel | Yes | Also useful later for preview deploys |
| Cloudflare Pages | Yes | Fastest global CDN |

Required env vars on the frontend host:
- `VITE_CONVEX_URL` → your `https://<project>.convex.cloud` URL

---

## 5. Going 24×7 — leaving the Freebuff preview behind

The Freebuff environment is for **development and preview only**. Once its
free tokens expire, the preview may stop — but that does NOT take the app
down, because production never runs there. Do this once and Aria runs 24×7
from its own infrastructure.

### Option A — Fastest live URL (Convex static hosting, already configured)

`convex.json` already has `buildCommand` + `outputDirectory`, so one command
puts the **whole app** — backend + frontend — live:

```bash
bunx convex dev --once    # this project, to get the function list green
bunx convex deploy        # asks you to log in, then deploys schema + functions
                          # AND builds + serves the frontend at your URL
```

Your permanent URL is then **`https://<project>.convex.cloud`** — a real,
shareable, 24×7 address with HTTPS, no Vercel/Netlify needed. Convex injects
`VITE_CONVEX_URL` into the frontend build automatically, so the app is fully
functional at that URL the moment the deploy finishes.

> Build memory: the frontend build needs **≥ 4 GB RAM** — run it on your own
> machine or any free-tier CI, not inside a ~2 GB sandbox.

### Option B — Custom domain (free) on top of Option A

1. Buy a domain anywhere (~$10/yr) and add it in your Convex dashboard's
   hosting settings (automatic Let's Encrypt HTTPS), or
2. Connect the repo to **Vercel/Netlify/Cloudflare Pages** (free) with
   `VITE_CONVEX_URL` set to your `https://<project>.convex.cloud` URL and an
   SPA fallback to `index.html`, then point your domain at that host.

### Keys + uptime reality check

1. **Copy every key** from this project's Keys UI into your Convex dashboard
   env (same names: GITHUB_*, STRIPE_*, OPENROUTER_API_KEY, VAPID_*).
2. **GitHub OAuth**: the popup flow uses the GitHub OAuth app you created in
   Section 2 — add `https://<project>.convex.cloud` (or your custom domain)
   to its Authorized JavaScript origins + callback URLs.
3. **Uptime reality check:** Convex's free (Hobby) tier runs your functions
   and crons but pauses the deployment after a period of inactivity. For
   guaranteed 24×7 with the push cron and no pauses, Convex Pro (~$10/mo)
   is the only real cost — everything else stays on free tiers. The app is
   otherwise fully serverless; nothing needs to "run" continuously.

Web push specifics: notifications are sent by the **Convex cron** (every 10
minutes, `crons.ts`) even when every tab is closed, and by the open app every
5 minutes. Push requires the VAPID keypair — generate a fresh one if you ever
rotate: `node -e "console.log(require('web-push').generateVAPIDKeys())"`.

The Freebuff preview can then be treated as a staging environment only.

---

## 6. Domain + HTTPS

1. Buy a domain anywhere (~$10/yr).
2. In your host's dashboard: Domain settings → add your domain.
3. HTTPS is automatic (Let's Encrypt) on Netlify / Vercel / Cloudflare Pages.
4. Update the GitHub OAuth callback + Stripe webhook URLs to the production domain.
5. (Optional, free) Set up email forwarding `you@yourdomain.com` → your inbox.

---

## 7. Privacy & legal checklist

- [x] `/privacy` and `/terms` pages ship with the app (footer links).
- [x] Real name/address in the legal pages: **Aria Labs, Karan Kotwal and
      Shivam Kotwal, 2825 Azad Nagar, Ranjhi, Jabalpur, Madhya Pradesh
      482005, India** (LICENSE, Privacy, Terms).
- [x] Contact channels in the legal pages: **karankotwal31@gmail.com** and
      **+91 84840 33991** (Privacy, Terms, LICENSE).
- [ ] Review data flows against the privacy page:
      GitHub tokens are stored encrypted in Convex and never exposed to the
      client; AI requests (OpenRouter) only send the diff/file context you
      explicitly attach; Stripe handles payment data — Aria never sees cards.
- [ ] If you'll have EU users, add a cookie/analytics notice before adding
      any analytics script.
- [ ] LICENSE is proprietary ("all rights reserved") — remove nothing from it
      if you want to keep the code closed.

---

## 8. Post-launch sanity checks

1. **Auth**: sign up fresh (incognito) → connect GitHub → land in the dashboard.
2. **Billing**: buy Pro with Stripe test mode → confirm the plan flips
   server-side and the dashboard reflects it.
3. **Webhook**: confirm `checkout.session.completed` appears in Stripe logs
   and the subscription row updates.
4. **AI**: ask Aria a question with `OPENROUTER_API_KEY` set.
5. **Mobile**: open the app on a phone — keyboard toolbar, focus mode,
   draft vault sync.
6. **Offline**: airplane mode → make a draft edit → reconnect → confirm it
   replays via the reconciliation buffer.
7. **Push**: enable notifications in the header bell, close the tab, then ask
   a teammate to assign you an issue — the notification should arrive within
   10 minutes (cron) and open the right page when clicked.
8. **Push actions**: on a PR awaiting your review, the notification shows
   **Approve / Comment / Merge** buttons. With a tab open they run instantly
   (Approve + Merge via the signed-in token, Comment opens the PR); with no
   tab open, tapping one opens Aria and performs it from the URL.
9. **Command palette**: press **⌘K / Ctrl+K** anywhere in the workspace —
   jump to the inbox, AI review, issues, PRs, history, code search, draft
   vault, billing, admin, or the stress test.

---

## 9. Optional (later) — no rush, still cheap

- **Custom domain email** — free forwarding or ~$1/mo (Zoho/ImprovMX).
- **Error monitoring** — Sentry free tier.
- **Analytics** — Plausible / PostHog free tiers (add cookie notice).
- **Second Stripe product** — Pro+ tier (unlimited Ask Aria, AI review on push).
