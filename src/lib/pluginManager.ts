/**
 * Aria's plugin manager.
 *
 * "Plugins" here are the runtime capabilities Aria relies on — the editor
 * engine, background workers, share sheet, notifications, persistent storage,
 * and app installation. Everything ships inside Aria's own bundle; nothing is
 * downloaded from third parties at runtime. Each plugin declares exactly what
 * it does and its data policy so the UI can show a transparent, per-plugin
 * prompt before anything is activated.
 *
 * Safety guarantees (enforced by design, not just promises):
 * - No plugin loads third-party scripts or makes network calls of its own.
 * - Core plugins are bundled and auto-install (they're already loaded).
 * - Device plugins either require zero permissions or ask the browser's own
 *   permission prompt (e.g. notifications) at an explicit user click.
 * - Installed state is stored in localStorage only (with an in-memory
 *   fallback when storage is blocked, e.g. in a sandboxed preview).
 */

import { getRuntimeProfile, type RuntimeProfile } from "./runtime";

export type PluginStatus = "active" | "available" | "unsupported" | "blocked";

export interface AriaPlugin {
  id: string;
  name: string;
  category: "core" | "device";
  description: string;
  /** Human-readable privacy statement shown next to the plugin. */
  privacy: string;
  dataPolicy: "local-only" | "user-initiated";
  /** Core plugins activate automatically on first run; device plugins wait for a click. */
  autoInstall: boolean;
  detect: (r: RuntimeProfile) => PluginStatus;
  install: (r: RuntimeProfile) => Promise<boolean>;
}

export const ARIA_PLUGINS: AriaPlugin[] = [
  {
    id: "editor",
    name: "Editor Engine",
    category: "core",
    description:
      "The Monaco code editor with syntax highlighting for 30+ languages — already bundled with Aria.",
    privacy:
      "Runs entirely in your browser. No code is downloaded and no data leaves your device.",
    dataPolicy: "local-only",
    autoInstall: true,
    detect: () => "active",
    install: async () => true,
  },
  {
    id: "workers",
    name: "Background Workers",
    category: "core",
    description:
      "Web Workers that keep editing and syntax highlighting fast on this device.",
    privacy: "Pure local computation — nothing is sent anywhere.",
    dataPolicy: "local-only",
    autoInstall: true,
    detect: (r) => (r.capabilities.workers ? "active" : "unsupported"),
    install: async () => true,
  },
  {
    id: "persistent-storage",
    name: "Persistent Storage",
    category: "device",
    description:
      "Ask the browser to keep your unsaved drafts even when storage is under pressure.",
    privacy: "Data stays on this device inside the browser's own storage.",
    dataPolicy: "local-only",
    autoInstall: false,
    detect: (r) =>
      r.capabilities.persistentStorage ? "available" : "unsupported",
    install: async (r) => {
      if (!r.capabilities.persistentStorage) return false;
      try {
        return await navigator.storage.persist();
      } catch {
        return false;
      }
    },
  },
  {
    id: "share",
    name: "Share Sheet",
    category: "device",
    description:
      "Share a file or commit from Aria to other apps on this device.",
    privacy: "Only shares content you explicitly choose to share — nothing else.",
    dataPolicy: "user-initiated",
    autoInstall: false,
    detect: (r) => (r.capabilities.share ? "available" : "unsupported"),
    install: async () => true,
  },
  {
    id: "notifications",
    name: "Desktop Notifications",
    category: "device",
    description:
      "Optional alerts when a commit or CI check finishes while you're elsewhere.",
    privacy:
      "Notifications never contain secrets, and nothing is sent to any server.",
    dataPolicy: "local-only",
    autoInstall: false,
    detect: (r) =>
      r.capabilities.notifications && r.deviceType === "desktop"
        ? "available"
        : "unsupported",
    install: async () => {
      try {
        const permission = await Notification.requestPermission();
        return permission === "granted";
      } catch {
        return false;
      }
    },
  },
  {
    id: "pwa",
    name: "Install as App",
    category: "device",
    description:
      "Add Aria to your home screen or dock and launch it full-screen like a native app.",
    privacy:
      "Standard browser install — only Aria's own bundle is ever used.",
    dataPolicy: "local-only",
    autoInstall: false,
    detect: (r) =>
      r.standalone ? "active" : r.inPreview ? "blocked" : "available",
    install: async () => true,
  },
];

// ---------------------------------------------------------------------------
// Persisted state (localStorage with an in-memory fallback)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "aria.plugins.v1";

interface PluginState {
  installed: Record<string, boolean>;
}

const DEFAULT_STATE: PluginState = { installed: {} };

// In-memory fallback so a sandboxed preview (blocked localStorage) still works.
let memoryState: PluginState | null = null;

function readState(): PluginState {
  if (memoryState) return memoryState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PluginState>;
      memoryState = {
        installed:
          parsed.installed && typeof parsed.installed === "object"
            ? parsed.installed
            : {},
      };
      return memoryState;
    }
  } catch {
    // Storage blocked — fall through to memory.
  }
  memoryState = { ...DEFAULT_STATE };
  return memoryState;
}

function writeState(state: PluginState): void {
  memoryState = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked — memory copy above still applies for this session.
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PluginStatusRow {
  plugin: AriaPlugin;
  status: PluginStatus;
  installed: boolean;
}

/** Current status of every plugin on this device. */
export function getPluginStates(): PluginStatusRow[] {
  const runtime = getRuntimeProfile();
  const state = readState();
  return ARIA_PLUGINS.map((plugin) => {
    const detected = plugin.detect(runtime);
    if (detected === "unsupported" || detected === "blocked") {
      return { plugin, status: detected, installed: false };
    }
    return {
      plugin,
      status: state.installed[plugin.id] ? "active" : "available",
      installed: !!state.installed[plugin.id],
    };
  });
}

/** Activate a plugin. Returns whether it succeeded (and why not). */
export async function installPlugin(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const plugin = ARIA_PLUGINS.find((p) => p.id === id);
  if (!plugin) return { ok: false, error: "Unknown plugin." };
  const runtime = getRuntimeProfile();
  const detected = plugin.detect(runtime);
  if (detected === "unsupported") {
    return { ok: false, error: "This device doesn't support that plugin." };
  }
  if (detected === "blocked") {
    return {
      ok: false,
      error: "This plugin isn't available in the hosted preview.",
    };
  }
  try {
    const ok = await plugin.install(runtime);
    if (ok) {
      const state = readState();
      state.installed[id] = true;
      writeState(state);
      return { ok: true };
    }
    return { ok: false };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "The plugin couldn't be installed.",
    };
  }
}

// Module-level guard: core plugins auto-install once per page load (survives
// React StrictMode's double-mount in development).
let autoInstallDone = false;

/**
 * Activate the bundled core plugins and report what happened, exactly once
 * per page load. Returns null when it already ran (or has nothing to do).
 */
export function autoInstallCore(): Array<{
  id: string;
  name: string;
  installed: boolean;
}> | null {
  if (autoInstallDone) return null;
  autoInstallDone = true;
  const runtime = getRuntimeProfile();
  const state = readState();
  const results: Array<{ id: string; name: string; installed: boolean }> = [];
  for (const plugin of ARIA_PLUGINS) {
    if (!plugin.autoInstall) continue;
    const detected = plugin.detect(runtime);
    const ok = detected !== "unsupported" && detected !== "blocked";
    if (ok) state.installed[plugin.id] = true;
    results.push({ id: plugin.id, name: plugin.name, installed: ok });
  }
  writeState(state);
  return results;
}

/** How many optional device plugins are available but not yet installed. */
export function optionalAvailableCount(): number {
  return getPluginStates().filter(
    (row) => row.status === "available" && !row.installed,
  ).length;
}
