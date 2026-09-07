/* Aria — service worker.
 *
 * Responsibilities:
 *  1. PWA installability.
 *  2. Web Push delivery and safe notification navigation.
 *  3. Production app-shell caching for repeat/offline launches.
 *
 * Caching is enabled by registering with `?cache=1` (main.tsx does this only
 * in production builds). Development stays network-only so stale caches cannot
 * shadow the dev server.
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
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches
                .open(CACHE_NAME)
                .then((cache) => cache.put("/index.html", copy));
            }
            return response;
          })
          .catch(async () => (await caches.match("/index.html")) ?? Response.error()),
      );
      return;
    }
    if (url.pathname.startsWith("/assets/")) {
      event.respondWith(
        caches.match(request).then((cached) => {
          const network = fetch(request)
            .then((response) => {
              if (response.ok) {
                const copy = response.clone();
                void caches
                  .open(CACHE_NAME)
                  .then((cache) => cache.put(request, copy));
              }
              return response;
            })
            .catch(() => cached ?? Response.error());
          return cached ?? network;
        }),
      );
      return;
    }
  }

  // Convex, GitHub, and other non-shell requests remain network-only.
});

function safeNotificationUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return "/";
  try {
    const url = new URL(value, self.location.origin);
    // Same-origin navigation is allowed. External links must be HTTPS. This
    // preserves GitHub deep links while rejecting javascript:/data:/file: etc.
    if (url.origin !== self.location.origin && url.protocol !== "https:") {
      return "/";
    }
    return url.href;
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let payload = { title: "Aria", body: "", url: "/", tag: "aria" };
  try {
    if (event.data) {
      const parsed = JSON.parse(event.data.text());
      if (parsed && typeof parsed === "object") {
        payload = { ...payload, ...parsed };
      }
    }
  } catch {
    // Non-JSON payload — fall back to safe defaults.
  }

  const title = typeof payload.title === "string" ? payload.title.slice(0, 160) : "Aria";
  const options = {
    body: typeof payload.body === "string" ? payload.body.slice(0, 500) : "",
    icon: "/logo.svg",
    badge: "/logo.svg",
    tag: typeof payload.tag === "string" ? payload.tag.slice(0, 120) : "aria",
    data: { url: safeNotificationUrl(payload.url) },
  };

  // These open the authenticated app, where write actions require confirmation.
  if (payload.kind === "review") {
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
  const destination = safeNotificationUrl(event.notification.data?.url);
  const app = new URL("/dashboard", self.location.origin);
  if (event.action) {
    app.searchParams.set("ariaAction", event.action);
    app.searchParams.set("ariaUrl", destination);
  }
  const target = event.action ? app.href : destination;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        for (const client of clients) {
          if (!("focus" in client)) continue;
          try {
            if ("navigate" in client) await client.navigate(target);
          } catch {
            // If an existing window cannot navigate, opening a new safe window
            // below is preferable to failing the click entirely.
          }
          return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
        return undefined;
      }),
  );
});
