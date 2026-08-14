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
  const data = event.notification.data ?? {};
  const url = data.url ?? "/";
  const action = event.action ?? null;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // An action button was tapped: hand it to an open Aria tab, or open the
      // app with the action in the URL for the boot handler to pick up.
      if (action) {
        for (const client of clients) {
          client.focus();
          client.postMessage({ type: "aria-push-action", action, url });
          return;
        }
        // No open tab: open Aria with the action encoded in the query string.
        // registration.scope is the app's origin, so this stays on the app
        // (never navigates to github.com) and the boot handler performs it.
        const scope = new URL("./", self.registration.scope).href;
        const actionUrl =
          `${scope}?ariaAction=${encodeURIComponent(action)}` +
          `&ariaUrl=${encodeURIComponent(url)}`;
        return self.clients.openWindow(actionUrl);
      }

      // Plain tap: focus an open tab and navigate it (or open the item).
      for (const client of clients) {
        client.focus();
        if ("navigate" in client && url !== "/") {
          client.navigate(url);
        }
        return;
      }
      return self.clients.openWindow(url);
    })(),
  );
});
