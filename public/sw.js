/* Aria — service worker.
 *
 * Two jobs:
 *  1. PWA installability (a registered SW with a fetch handler is required).
 *  2. Web push: receives push events from the browser push service and turns
 *     them into notifications; clicking one focuses the app (or opens it).
 *
 * The fetch handler is intentionally network-only: nothing is cached, so the
 * app always runs fresh and the dev server can never be shadowed by a stale
 * cache.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Network-only pass-through.
});

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
    // Non-JSON payload — fall back to the defaults.
  }
  const title = typeof payload.title === "string" ? payload.title : "Aria";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: "/logo.svg",
    badge: "/logo.svg",
    tag: typeof payload.tag === "string" ? payload.tag : "aria",
    data: { url: typeof payload.url === "string" ? payload.url : "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client && url !== "/") {
              client.navigate(url);
            }
            return;
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
