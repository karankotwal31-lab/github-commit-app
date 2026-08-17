# Aria Desktop (Tauri shell)

A **native desktop shell** around the same web app the browser uses — an
honest webview wrapper, not a rewrite. It gives the product what the browser
can't: its own window, dock/taskbar presence, and (later, if wanted) local
filesystem access through Tauri commands — with zero duplicated logic.

- The window loads `https://steady-scorpion-839.convex.site` (the deployed
  app) at startup; override with the `ARIA_URL` env var for staging.
- `src-tauri/web/index.html` is the offline fallback shipped with the bundle
  (it redirects to the deployed app).
- Capabilities are locked down to `core:default` — no shell/fs permissions.

## Build it on your machine (the sandbox cannot compile Rust)

Prereqs: [Rust](https://rustup.rs) (stable) + the Tauri CLI.

```bash
# one-time: generate the app icons from any 1024x1024 png
bunx tauri icon path/to/icon-1024.png      # writes src-tauri/icons/

# dev (opens a native window pointed at the deployed app)
cd src-tauri
bunx tauri dev

# release bundles (msi / dmg / appimage / deb depending on OS)
bunx tauri build
```

`ARIA_URL` example: `ARIA_URL=https://fearless-starling-421.convex.cloud bunx tauri dev`

## Honest notes

- Icons must be generated locally (`tauri icon`) — binary assets can't be
  produced in this environment; until then `tauri build` will fail at the
  icon step, not the code step.
- This shell adds *native presence*, not *native capability* — the browser
  app already has the real git engine, AI, and offline draft vault. If you
  later want genuinely native features (local repo checkout on disk, custom
  URI scheme), they're added here as Tauri commands, not in the web app.
- Publish the public URL first: the desktop app is only as current as the
  deployment it points at.
