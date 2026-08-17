# Aria — Deployment & Integration Playbook

This playbook is the single source of truth for shipping changes to the deployed
app **without repeating the errors we have already hit**. It has three parts:

1. **The error catalog** — every error class encountered while building and
   deploying this app, with the root cause and the rule that prevents it.
2. **The golden checklist** — the exact order of operations for any change,
   from edit to verified live deployment.
3. **The never-do list** — hard rules that exist because each one caused a real
   incident once.

The single command that gates every change is:

```bash
bun run verify   # convex codegen + push → typecheck → full test suite
```

---

## Part 1 — Error catalog (what went wrong, and the rule that stops it)

| # | Error / symptom | Root cause | Prevention rule |
|---|---|---|---|
| 1 | `FATAL ERROR: Reached heap limit` / `Killed` during install/build | Heavy install/build in the memory-constrained sandbox. **Measured:** the container has a hard **2 GB cgroup memory cap** with ~475 MB already reserved by the managed dev processes, and this app's production build (Monaco graph) peaks above that — verified twice (cgroup SIGKILL at default heap; node OOM at `--max-old-space-size=1400`) | Use **Bun** for everything. Never run `vite build` in the sandbox — `bun run verify` (codegen + `tsc -b --noEmit` + tests) is the gate. The frontend **cannot be built in this sandbox at all**; production builds must happen on the Freebuff platform's own infra via the publish flow |
| 1b | `bun run deploy` (`@convex-dev/static-hosting deploy`) targets the wrong deployment | The local CLI is linked to the **dev** deployment (e.g. `fearless-starling-421.convex.site`), not the public URL (e.g. `steady-scorpion-839.convex.site`) which the platform publishes. Running it locally would deploy to dev even if the build succeeded | The public URL is published **only** through the Freebuff project UI (publish action / `freebuff.com/project/<name>?publish=true`). The platform builds on its own infra and ships frontend + functions to the public URL atomically. Never use a local deploy to "fix" the public URL — it can't reach it |
| 2 | `[CONVEX A(auth:signIn)] … Server Error` — "Failed to sign in as guest" | Auth provider keys missing/mismatched on the deployment, or the GitHub OAuth callback URL didn't match the registered one | Set **all** keys in the project's Keys/API-keys UI **before** the first sign-in attempt. The callback URL must match the OAuth app exactly: `https://<project>.convex.site/api/github/callback`. Check the Convex dashboard logs when auth errors appear |
| 3 | Private key pasted into chat with line-break corruption | Secrets were pasted into the conversation; line breaks and formatting mangled them, and the key was exposed to the session | **Never paste keys or secrets into chat — ever.** Paste into the project Keys UI only. Anything that was pasted in chat is considered compromised: rotate it immediately. Use least-privilege tokens for external integrations |
| 4 | "Blocked: the Convex files you just changed do not compile yet" (edit tool refused writes) | Platform safety gate: after any edit under `src/convex/`, other file edits are held until `convex dev --once` + `tsc` pass, so generated types can't go stale mid-edit | After touching any file under `src/convex/`, run `bunx convex dev --once` **immediately** and fix what it reports before editing anything else. Don't fight the gate with file moves |
| 5 | `convex dev --once` auth failure / `DaytonaError: Request failed with status code 502` | Transient platform/network failure during codegen; occasionally a stale CLI auth token | Treat as transient: retry after a few seconds. **Never hand-edit `src/convex/_generated/*`** to "fix" types. If auth genuinely fails, stop and report — never claim verification passed |
| 6 | `Could not resolve "node:crypto"` in `src/convex/cli.ts` | Convex's default (V8) runtime doesn't bundle Node built-ins; only files marked `"use node"` get them | Before importing any Node built-in, check what the project already does (e.g. `stripeWebhook.ts` uses `"use node"`). In default-runtime files use web APIs (`crypto.subtle`, `crypto.getRandomValues`) or a dependency-free implementation (`src/convex/sha256.ts`) |
| 7 | HTTP actions: `ctx.db` does not exist on `GenericActionCtx` | In the installed Convex version, `httpAction` context has no direct DB access | Route all DB work from HTTP handlers through `ctx.runQuery` / `ctx.runMutation` to internal functions — the verified pattern in `src/convex/http.ts` + `src/convex/cli.ts` |
| 8 | Web push silently never fired; `serviceWorker.ready` hung | `public/sw.js` existed but nothing ever registered it | When adding PWA/background features, verify the **wiring**, not just the file: registration in `main.tsx`, correct scope, and a smoke test in the built app |
| 9 | Font didn't apply after adding `@import "@fontsource-variable/inter"` in CSS | Tailwind v4's pipeline doesn't reliably inline CSS `@import` of a package | Import packages through the **bundler** in `main.tsx` (`import "@fontsource-variable/inter"`), keep `index.css` `@import`s to CSS files, then verify the woff2 files exist in the build |
| 10 | New routes returned 404 on the public URL while working in the preview | `convex dev --once` pushes to the **dev** deployment; the public URL serves the last **published** bundle | After adding HTTP routes or client code, the platform **publish** step must run. Verify against the public URL with `curl` after publishing; don't conclude success or failure before that |
| 11 | `str_replace` "old string not found" right after a successful edit to the same file | Edit-tool snapshot lag on large files after many sequential edits | Batch edits to a large file into one patch; if a replacement fails right after an edit, **re-read the region first**, then retry with the exact on-disk text |
| 12 | Type errors for APIs that don't exist in the installed Convex (e.g. `"skip"` revalidation, `ctx.runMutation` naming) | Code written against newer Convex docs than the installed version (1.30) | Check the installed version's types in `node_modules` before using a new API; compile after every backend change. `bun run verify` catches this at the earliest safe point |
| 13 | Sign-in loop: `RequireAuth` bounced back to `/auth` forever | Auth config drifted from the deployment's token format (e.g. switching a provider to `customJwt` breaks `kid`-less self-issued tokens) | Keep `src/convex/auth.config.ts` compatible with the deployment's token format — the file's comments document the exact constraints. Test sign-in end-to-end after any auth change |
| 14 | Stale app shell after an update (SW served old assets) | Service worker cached the shell; cache name never versioned | Cache only in production (`?cache=1`), dev stays network-only so the preview can never be shadowed; bump the cache name when the shell changes; hard-refresh (Ctrl/Cmd+Shift+R) after font/asset changes |
| 15 | In-app AI/CI features calling a hard-coded provider key | A backend file bypassed the shared provider abstraction with its own fetch + env name | All AI calls go through the shared abstraction (`chatCompletion()` in `src/convex/aiProvider.ts`). `bun run verify` plus a stale-reference grep keeps new call sites honest |

---

## Part 2 — The golden checklist (any change, in order)

### Phase 0 — Before touching code
- [ ] Confirm you are at the project root (paths are relative to it).
- [ ] Confirm the package manager is **Bun** and the Convex project is linked.
- [ ] Read `LAUNCH.md` / `README.md` for any platform-specific commands.

### Phase 1 — While editing
- [ ] **Convex backend edits** (`src/convex/**`): run `bunx convex dev --once` right
      after the edit, fix reported errors, then continue. Never leave unverified
      Convex edits behind.
- [ ] **Frontend edits**: `bunx tsc -b --noEmit` after risky refactors or new APIs.
- [ ] **Large files**: batch edits into single patches; re-read before retrying a
      failed replacement.
- [ ] **Node built-ins**: only in `"use node"` files; everything else uses web APIs.
- [ ] **New API surface**: check the installed package version's types before using it.

### Phase 2 — The verification gate (before any deploy)
- [ ] `bun run verify` → must exit 0: Convex codegen + push, `tsc -b --noEmit`, full test suite.
- [ ] Grep for stale references if anything provider-related changed
      (`grep -rn "OPENROUTER_API\b\|DEFAULT_MODEL" src`).
- [ ] `node --check public/sw.js` if the service worker changed.
- [ ] Confirm no `.env` edits, no `vite.config.ts` HMR changes, no
      `src/convex/_generated/*` hand-edits.

### Phase 3 — Keys & integrations (do these in the Keys UI, never in chat)
- [ ] **GitHub OAuth** — register an OAuth app at `github.com/settings/developers` with
      callback URL `https://<project>.convex.site/api/github/callback`; set
      `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` in the project Keys.
- [ ] **Stripe** — webhook secret + endpoint URL; the backend already dedupes events.
- [ ] **AI providers** — `OPENROUTER_API_KEY` (+ `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
      as fallbacks) in the project Keys; the keys never leave the server.
- [ ] **Convex auth** — `CONVEX_SITE_URL` is deployment-managed; the auth config ships
      with the code, so it deploys together with the functions.

### Phase 4 — Publish & verify the live URL
- [ ] Trigger the platform **publish/deploy** (this is the step that makes the
      public URL serve the new bundle).
- [ ] After publishing, smoke-test the public URL with `curl`:
      root page, any new `/api/...` routes, `/manifest.webmanifest`, `/sw.js`.
- [ ] In the browser, hard-refresh (Ctrl/Cmd+Shift+R) so a cached stylesheet or
      old service worker can't mask the change.
- [ ] Check the browser console for service-worker or runtime errors.

### Phase 5 — Post-deploy health
- [ ] Sign in end-to-end (email OTP or GitHub OAuth) and reach the dashboard.
- [ ] Run the in-app diagnostics (Platform → Runtime / health checks).
- [ ] Review `errorLogs` for anything the health checks don't surface.

---

## Part 3 — The never-do list

1. **Never paste a secret or key into chat.** Rotate anything that was ever pasted.
2. **Never hand-edit `src/convex/_generated/*`.** Regenerate with `bunx convex dev --once`.
3. **Never run interactive `convex dev` without `--once`** — it hangs in non-interactive terminals.
4. **Never edit `.env` files** — secrets belong in the project Keys UI.
5. **Never modify `vite.config.ts` HMR settings** (`server.hmr: false` must stay).
6. **Never run `vite build` / full production builds in the sandbox** — `bun run verify` is the gate.
7. **Never start, stop, or kill dev/preview servers** — the platform manages them.
8. **Never claim a deploy is live until the publish step ran and curl confirmed it.**
9. **Never add a Node built-in to a default-runtime Convex file.**
10. **Never leave a Convex edit unverified** — codegen before moving on.

---

## What is automatic vs. what still needs a human

- **Automatic:** codegen, typecheck, tests, the secret-scan gate, Stripe webhook
  dedup, error logging, rate limits, AI in-flight guards.
- **Still human:** reading `errorLogs` and acting on them; rotating exposed keys;
  pressing publish and confirming the public URL; deciding policy in the release
  center. No amount of automation replaces the Phase 4 publish step.
