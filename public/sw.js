/* Aria — service worker.
 *
 * Three jobs:
 *  1. PWA installability (a registered SW with a fetch handler is required).
 *  2. Web push: receives push events from the browser push service and turns
 *     them into notifications; clicking one focuses the app (or opens it).
 *  3. App-shell caching (production only): the static shell (index.html,
 *     hashed JS/CSS assets, fonts, manifest) is cached so the app opens
 *     instantly on repeat visits, even on slow connections. Git operations
 *     still need the network — this only makes the app itself load fast.
 *
 * Caching is enabled by registering with `?cache=1` (main.tsx does this only
 * in production builds). In development the SW stays network-only, so the
 * dev server can never be shadowed by a stale cache.
 */

const CACHE_NAME = "aria-shell-v1";
const CACHE_ENABLED = new URL(self.location.href).searchParams.get("cache") === "1";

const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/logo.svg"];

self.addEventListener("install", (event) => {
  if (CACHE_ENABLED) {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.addAll(APP_SHELL))
        .then(() => self.skipWaiting()),
    );
  } else {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if (CACHE_ENABLED) {
        // Drop caches from older versions of the app shell.
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        );
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (CACHE_ENABLED && new URL(request.url).origin === self.location.origin) {
    const url = new URL(request.url);
    if (request.mode === "navigate") {
      // App shell: network first (fresh deploy wins), fall back to the
      // cached shell when offline so the app still opens.
      event.respondWith(
        fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
            return response;
          })
          .catch(() => caches.match("/index.html")),
      );
      return;
    }
    if (url.pathname.startsWith("/assets/")) {
      // Hashed static assets: cache-first with background refresh. The hash
      // in the file name means a stale entry can never serve wrong code.
      event.respondWith(
        caches.match(request).then((cached) => {
          const network = fetch(request)
            .then((response) => {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
              return response;
            })
            .catch(() => cached);
          return cached || network;
        }),
      );
      return;
    }
  }

  // Everything else (Convex, GitHub, dev assets): network-only pass-through.
});

self.addEventListener("push", (event) => {
  let payload = { title: "Aria", body: "", url: "/", tag: "aria", kind: "assign" };
  try {
    if (event.data) {
      const parsed = JSON.parse(event.data.text());
      if (parsed && typeof parsed === "object") {
        payload = { ...payload, ...parsed };
      }
    }
  } catch {
    // Non-JSON payload — fall back to the defaults.
  }
  const title = typeof payload.title === "string" ? payload.title : "Aria";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: "/logo.svg",
    badge: "/logo.svg",
    tag: typeof payload.tag === "string" ? payload.tag : "aria",
    data: {
      url: typeof payload.url === "string" ? payload.url : "/",
      kind: payload.kind === "review" ? "review" : "assign",
    },
  };
  // PR-review notifications carry Approve / Comment / Merge actions.
  if (options.data.kind === "review") {
    options.actions = [
      { action: "approve", title: "✓ Approve" },
      { action: "comment", title: "💬 Comment" },
      { action: "merge", title: "🔀 Merge" },
    ];
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
