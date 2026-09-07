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
const REVIEW_ACTIONS = new Set(["approve", "comment", "merge"]);

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

function isGithubPullUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function actionLaunchUrl(action, target) {
  const url = new URL("/dashboard", self.location.origin);
  url.searchParams.set("ariaAction", action);
  url.searchParams.set("ariaUrl", target);
  return url.href;
}

self.addEventListener("push", (event) => {
  let payload = {
    title: "Aria",
    body: "",
    url: "/",
    tag: "aria",
    kind: "assign",
  };
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

  const kind = payload.kind === "review" ? "review" : "assign";
  const target = safeNotificationUrl(payload.url);
  const title =
    typeof payload.title === "string" ? payload.title.slice(0, 160) : "Aria";
  const options = {
    body: typeof payload.body === "string" ? payload.body.slice(0, 500) : "",
    icon: "/logo.svg",
    badge: "/logo.svg",
    tag: typeof payload.tag === "string" ? payload.tag.slice(0, 120) : "aria",
    data: { url: target, kind },
  };

  // The app already has a signed-in PushActionHandler backed by the same
  // GitHub action layer as the normal review UI. Only surface write actions
  // for an actual github.com PR URL; otherwise the notification remains a
  // simple safe navigation notification.
  if (kind === "review" && isGithubPullUrl(target)) {
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
  const target = safeNotificationUrl(event.notification.data?.url);
  const kind = event.notification.data?.kind === "review" ? "review" : "assign";
  const action = typeof event.action === "string" ? event.action : "";
  const actionable =
    kind === "review" && REVIEW_ACTIONS.has(action) && isGithubPullUrl(target);

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      if (actionable) {
        // Keep the action inside Aria so it uses the signed-in user's existing
        // server-side GitHub token and normal permission/confirmation checks.
        for (const client of clients) {
          if (!("focus" in client)) continue;
          client.postMessage({
            type: "aria-push-action",
            action,
            url: target,
          });
          return client.focus();
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(actionLaunchUrl(action, target));
        }
        return undefined;
      }

      for (const client of clients) {
        if (!("focus" in client)) continue;
        try {
          if ("navigate" in client) await client.navigate(target);
        } catch {
          // Opening a new safe window below is preferable to dropping the tap.
          continue;
        }
        return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })(),
  );
});
