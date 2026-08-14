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
| Frontend hosting | `@convex-dev/static-hosting` component (serves `dist/` from your Convex deployment, SPA fallback built in) |

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

> Free Convex plan = $0/mo, runs 24×7, crons included, pay only if you exceed
> the included usage. No card required to start. See §5 "Uptime reality check".

> `STRIPE_PRICE_ID` (legacy) is still honored as the Pro price if
> `STRIPE_PRICE_ID_PRO` is unset — set the new keys and remove the old one
> once migration is done.

Managed automatically by the platform (do **not** set these):
`VLY_APP_NAME`, `VLY_CONVEX_AUTH_ISSUER`.

---

## 2. GitHub OAuth app

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App.
2. Homepage URL: your production URL (e.g. `https://<deployment>.convex.site`).
3. Authorization callback URL: `https://<deployment>.convex.site/api/github/callback`
   — this exact path is what `src/convex/http.ts` serves.
4. Copy the Client ID + Client Secret into the env vars above.
5. In the GitHub OAuth App settings, add the Convex dev URL as an extra
   callback for preview testing: `https://<your-dev>.convex.cloud/api/github/callback`
   (the dev URL shows up when you run `convex dev`).

---

## 3. Stripe setup (5-tier ladder)

1. Create one product per paid tier, each with a recurring monthly price:
   - **Aria Pro** — $12/mo → `STRIPE_PRICE_ID_PRO`
   - **Aria Pro+** — $29/mo → `STRIPE_PRICE_ID_PRO_PLUS`
   - **Aria Team** — $45/seat/mo (per-seat, metered quantity) → `STRIPE_PRICE_ID_TEAM`
2. Copy each Price ID into its env var above.
3. Deploy once (step 4), then create a webhook endpoint:
   - URL: `https://<deployment>.convex.site/api/stripe/webhook`
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

## 4. Deploy (one command, whole app)

Frontend hosting is wired up via the **`@convex-dev/static-hosting`** component
(`src/convex/convex.config.ts` + `registerStaticRoutes` in `http.ts`). One
command builds the frontend, deploys the backend, and uploads `dist/` to your
Convex deployment:

```bash
npm install
npm run deploy    # = npx @convex-dev/static-hosting deploy
```

That's it. Your app is live at **`https://<deployment>.convex.site`**
(HTTPS, SPA routing, smart caching — no Netlify/Vercel needed). The CLI sets
`VITE_CONVEX_URL` for the target deployment automatically, so the bundle talks
to the right backend.

Two-step alternative (e.g. after changing only the frontend):

```bash
npm run build
npx @convex-dev/static-hosting upload --build --prod
```

> **Build memory:** Aria bundles Monaco (large editor) — the production build
> needs **≥ 4 GB RAM**. Run it on your own machine or any free-tier CI; very
> small containers (~2 GB) can OOM during `vite build`.

Prefer an external host? Point **Netlify / Vercel / Cloudflare Pages** at the
repo with `VITE_CONVEX_URL` set to your `https://<deployment>.convex.cloud` URL
and an SPA fallback to `/index.html`. Free-tier-viable on all three.

---

## 5. Going 24×7 — leaving the Freebuff preview behind

The Freebuff environment is for **development and preview only**. Once its
free tokens expire, the preview may stop — but that does NOT take the app
down, because production never runs there. Do this once and Aria runs 24×7
from its own infrastructure.

### Option A — Fastest live URL (Convex static hosting, already wired up)

Good news: **the backend is already deployed and live.** `convex dev --once`
pushes to a running cloud deployment, and the current one answers at
`https://fearless-starling-421.convex.cloud` (dashboard:
`dashboard.convex.dev/t/freebuff/572346b3-b0f0-4f8d-9bdd-b2a65fe145b1/fearless-starling-421`).
What's missing is the **frontend** being served — one command puts the whole
app live on your own Convex account:

```bash
npm install
npm run deploy    # = npx @convex-dev/static-hosting deploy (builds + deploys + uploads)
```

Your permanent URL is then **`https://<deployment>.convex.site`** — a real,
shareable, 24×7 address with HTTPS, SPA routing, and caching, no Vercel/Netlify
needed. The CLI injects `VITE_CONVEX_URL` into the build automatically.

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
   Section 2 — add `https://<deployment>.convex.site` (or your custom domain)
   to its Authorized JavaScript origins + callback URLs, with the callback
   path `/api/github/callback`.
3. **Uptime reality check (2026 pricing):** Convex's **Free plan is $0/mo and
   runs continuously** — serverless, nothing to keep "on". Crons (the push
   notification scheduler) are included on Free. Free gives you 1M function
   calls, 20 GB-hours of action compute, 0.5 GB database, and 1 GB file
   storage per month; beyond that you pay-as-you-go at metered rates (only
   when you exceed the included amounts — you are never charged a flat fee,
   and data is never deleted). If you exceed limits for an extended period
   the deployment returns HTTP errors until usage drops or you upgrade.
   Upgrade to **Professional ($25/developer/mo)** when you want the much
   higher included limits, a custom domain, log streaming, daily backups,
   and email support — it is not required to launch.

Web push specifics: notifications are sent by the **Convex cron** (every 10
minutes, `crons.ts`) even when every tab is closed, and by the open app every
5 minutes. Push requires the VAPID keypair — generate a fresh one if you ever
rotate: `node -e "console.log(require('web-push').generateVAPIDKeys())"`.

The Freebuff preview can then be treated as a staging environment only.

---

## 6. Domain + HTTPS

1. Buy a domain anywhere (~$10/yr).
2. Convex hosting: add the domain in your Convex dashboard → project →
   Hosting settings (automatic Let's Encrypt HTTPS). Or, if you deployed the
   frontend to Netlify/Vercel/Cloudflare Pages, add it in that host's dashboard.
3. Update the GitHub OAuth callback + Stripe webhook URLs to the production
   domain (`https://yourdomain.com/api/github/callback`, `.../api/stripe/webhook`).
4. (Optional, free) Set up email forwarding `you@yourdomain.com` → your inbox.

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
