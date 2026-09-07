# Aria Desktop (Tauri shell)

A **native desktop shell** around the same web app the browser uses — an
honest webview wrapper, not a rewrite. It gives the product what the browser
can't: its own window, dock/taskbar presence, and (later, if wanted) local
filesystem access through Tauri commands — with zero duplicated logic.

- `ARIA_URL` is required to point the shell at the trusted production HTTPS
  origin. There is intentionally no historical deployment fallback.
- `src-tauri/web/index.html` is the bundled safe fallback. If `ARIA_URL` is
  missing, it shows a configuration message and does not navigate anywhere.
- Capabilities are locked down to `core:default` — no shell/fs permissions.

## Build it on your machine

Prereqs: [Rust](https://rustup.rs) (stable) + the Tauri CLI.

```bash
# one-time: generate the app icons from any 1024x1024 png
bunx tauri icon path/to/icon-1024.png      # writes src-tauri/icons/

# dev — point at the intended Aria deployment explicitly
cd src-tauri
ARIA_URL=https://YOUR_PUBLIC_APP_ORIGIN bunx tauri dev

# release bundles (msi / dmg / appimage / deb depending on OS)
ARIA_URL=https://YOUR_PUBLIC_APP_ORIGIN bunx tauri build
```

For local development, an explicit localhost URL is also acceptable.

## Honest notes

- Icons must be generated locally (`tauri icon`) before a release bundle can
  be produced if the required platform icon assets are not already present.
- This shell adds *native presence*, not *native capability* — the browser
  app already has the real git engine, AI, and offline draft vault. If you
  later want genuinely native features (local repo checkout on disk, custom
  URI scheme), they're added here as Tauri commands, not in the web app.
- Publish and verify the public production URL first. Package the desktop app
  only after that origin has passed the launch smoke tests in `LAUNCH.md`.
