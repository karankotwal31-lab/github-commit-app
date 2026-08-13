/**
 * Runtime sensing — detects where Aria is running (device type, OS, browser,
 * screen, connection, and web capabilities) so the app can adapt its layout
 * and decide which plugins to activate. All detection is local and read-only:
 * nothing here reads personal data or talks to any server.
 */

export type DeviceType = "desktop" | "tablet" | "mobile";

export interface RuntimeProfile {
  deviceType: DeviceType;
  os: string;
  browser: string;
  screen: {
    width: number;
    height: number;
    dpr: number;
    touch: boolean;
  };
  online: boolean;
  connection: {
    effectiveType: string | null;
    downlink: number | null;
  };
  capabilities: {
    workers: boolean;
    serviceWorker: boolean;
    clipboard: boolean;
    notifications: boolean;
    share: boolean;
    persistentStorage: boolean;
    secureContext: boolean;
  };
  /** Running inside the hosted preview (iframe / .vly.sh) rather than a real deployment. */
  inPreview: boolean;
  /** Installed as a standalone app (PWA). */
  standalone: boolean;
}

function detectOs(ua: string): string {
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/windows/i.test(ua)) return "Windows";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Unknown OS";
}

function detectBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return "Edge";
  if (/chrome\//i.test(ua)) return "Chrome";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/safari\//i.test(ua)) return "Safari";
  return "Browser";
}

function detectDeviceType(ua: string, touch: boolean): DeviceType {
  const isMobile =
    /iphone|ipod|android.*mobile|opera mini|iemobile|mobile/i.test(ua);
  const isTablet =
    /ipad|tablet|playbook|silk/i.test(ua) ||
    (/android/i.test(ua) && !/mobile/i.test(ua));
  if (isTablet) return "tablet";
  if (isMobile) return "mobile";
  // Touch laptops blur the line — treat small touch screens as tablets.
  if (touch && typeof window !== "undefined" && window.innerWidth < 1024) {
    return "tablet";
  }
  return "desktop";
}

function detectRuntime(): RuntimeProfile {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const touch =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0);

  let inPreview = false;
  try {
    const host = window.location.hostname;
    if (host.endsWith(".vly.sh")) inPreview = true;
    // A frame inside a parent page is also a preview context.
    if (window.self !== window.top) inPreview = true;
  } catch {
    inPreview = true;
  }

  let standalone = false;
  try {
    standalone =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    standalone = false;
  }

  const secureContext =
    typeof window.isSecureContext === "boolean"
      ? window.isSecureContext
      : typeof location !== "undefined" && location.protocol === "https:";

  // Network Information API (Chromium only) — best-effort.
  let effectiveType: string | null = null;
  let downlink: number | null = null;
  try {
    const conn = (
      navigator as Navigator & {
        connection?: { effectiveType?: string; downlink?: number };
      }
    ).connection;
    effectiveType = conn?.effectiveType ?? null;
    downlink = conn?.downlink ?? null;
  } catch {
    // Not available or blocked — treat as unknown.
  }

  return {
    deviceType: detectDeviceType(ua, touch),
    os: detectOs(ua),
    browser: detectBrowser(ua),
    screen: {
      width: typeof window !== "undefined" ? window.innerWidth : 0,
      height: typeof window !== "undefined" ? window.innerHeight : 0,
      dpr: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      touch,
    },
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    connection: { effectiveType, downlink },
    capabilities: {
      workers: typeof Worker !== "undefined",
      serviceWorker:
        typeof navigator !== "undefined" && "serviceWorker" in navigator,
      clipboard:
        typeof navigator !== "undefined" &&
        typeof navigator.clipboard !== "undefined",
      notifications: typeof window !== "undefined" && "Notification" in window,
      share:
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        secureContext,
      persistentStorage:
        typeof navigator !== "undefined" &&
        typeof navigator.storage !== "undefined" &&
        typeof navigator.storage.persist === "function",
      secureContext,
    },
    inPreview,
    standalone,
  };
}

// The profile is stable for the lifetime of the page — compute it once.
let cached: RuntimeProfile | null = null;

export function getRuntimeProfile(): RuntimeProfile {
  if (cached) return cached;
  cached = detectRuntime();
  return cached;
}
