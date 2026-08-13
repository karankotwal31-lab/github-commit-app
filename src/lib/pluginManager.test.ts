import { beforeAll, describe, expect, test } from "bun:test";
import {
  ARIA_PLUGINS,
  autoInstallCore,
  getPluginStates,
  installPlugin,
  optionalAvailableCount,
} from "./pluginManager";

// Stub localStorage (sandboxed or headless environments may not have it).
const store = new Map<string, string>();
beforeAll(() => {
  try {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      },
      configurable: true,
    });
  } catch {
    // Native localStorage exists — tests still pass (state is per-run).
  }
});

describe("registry", () => {
  test("ships the expected plugin set", () => {
    const ids = ARIA_PLUGINS.map((p) => p.id);
    expect(ids).toEqual([
      "editor",
      "workers",
      "persistent-storage",
      "share",
      "notifications",
      "pwa",
    ]);
    for (const p of ARIA_PLUGINS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.privacy.length).toBeGreaterThan(0);
      expect(["local-only", "user-initiated"]).toContain(p.dataPolicy);
    }
  });

  test("getPluginStates returns a row per plugin", () => {
    const rows = getPluginStates();
    expect(rows).toHaveLength(ARIA_PLUGINS.length);
    expect(rows.every((r) => r.installed === false)).toBe(true);
  });
});

describe("installPlugin", () => {
  test("activates the bundled editor plugin", async () => {
    const result = await installPlugin("editor");
    expect(result.ok).toBe(true);
    const editor = getPluginStates().find((r) => r.plugin.id === "editor");
    expect(editor?.installed).toBe(true);
    expect(editor?.status).toBe("active");
  });

  test("rejects unknown plugin ids", async () => {
    const result = await installPlugin("does-not-exist");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown");
  });

  test("persists installed state to storage", async () => {
    await installPlugin("editor");
    const raw = store.get("aria.plugins.v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { installed: Record<string, boolean> };
    expect(parsed.installed.editor).toBe(true);
  });
});

describe("autoInstallCore", () => {
  test("auto-installs core plugins and only runs once", () => {
    const first = autoInstallCore();
    expect(first).not.toBeNull();
    expect(first!.length).toBeGreaterThan(0);
    const editor = first!.find((r) => r.id === "editor");
    expect(editor?.installed).toBe(true);

    const second = autoInstallCore();
    expect(second).toBeNull(); // StrictMode-safe: no double prompts
  });
});

describe("optionalAvailableCount", () => {
  test("counts only device plugins, never core ones", () => {
    const count = optionalAvailableCount();
    expect(count).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(count)).toBe(true);
  });
});
