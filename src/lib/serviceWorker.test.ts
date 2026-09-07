import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const notifications: any[] = [];
  const opened: string[] = [];
  runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), {
    URL, Response,
    self: {
      location: { origin: "https://app.example", href: "https://app.example/sw.js" },
      addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; },
      registration: { showNotification: async (_title: string, options: any) => { notifications.push(options); } },
      clients: {
        matchAll: async () => [],
        openWindow: async (url: string) => { opened.push(url); },
      },
    },
  });
  return { handlers, notifications, opened };
}

test("review notifications retain all three actions", async () => {
  const w = worker();
  let pending: Promise<unknown> = Promise.resolve();
  w.handlers.push({
    data: { text: () => JSON.stringify({ kind: "review", url: "https://github.com/o/r/pull/2" }) },
    waitUntil: (p: Promise<unknown>) => { pending = p; },
  });
  await pending;
  expect(w.notifications[0].actions.map((a: any) => a.action)).toEqual(["approve", "comment", "merge"]);
});

test("action taps open the app confirmation flow, not a direct write", async () => {
  const w = worker();
  let pending: Promise<unknown> = Promise.resolve();
  const pr = "https://github.com/o/r/pull/2";
  w.handlers.notificationclick({
    action: "merge", notification: { close() {}, data: { url: pr } },
    waitUntil: (p: Promise<unknown>) => { pending = p; },
  });
  await pending;
  const url = new URL(w.opened[0]);
  expect(url.origin).toBe("https://app.example");
  expect(url.pathname).toBe("/dashboard");
  expect(url.searchParams.get("ariaAction")).toBe("merge");
  expect(url.searchParams.get("ariaUrl")).toBe(pr);
});

test("ordinary taps preserve safe deep links and reject executable URLs", async () => {
  for (const [input, expected] of [
    ["https://github.com/o/r/pull/2", "https://github.com/o/r/pull/2"],
    ["/dashboard?tab=inbox", "https://app.example/dashboard?tab=inbox"],
    ["javascript:alert(1)", "/"],
  ]) {
    const w = worker();
    let pending: Promise<unknown> = Promise.resolve();
    w.handlers.notificationclick({
      action: "", notification: { close() {}, data: { url: input } },
      waitUntil: (p: Promise<unknown>) => { pending = p; },
    });
    await pending;
    expect(w.opened[0]).toBe(expected);
  }
});
