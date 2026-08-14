/* Aria — minimal service worker.
 *
 * Purpose: satisfy PWA installability criteria (Chrome requires a registered
 * service worker with a fetch handler) WITHOUT introducing stale caches that
 * could fight the dev server or hold onto old versions of the app.
 *
 * Everything is network-first by default: this worker never intercepts or
 * caches responses, so the app always runs fresh.
 */
self.addEventListener("install", () => {
  // Don't wait for old tabs to close before activating.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Network-only pass-through. Keeps installability without cache risks.
});
