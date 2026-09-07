/** Client-side Web Push helpers. */

/**
 * VAPID public keys are public, but they must still be deployment-specific.
 * Keeping the value in a Vite public env var prevents a stale/placeholder key
 * from being silently baked into every production bundle.
 */
export const VAPID_PUBLIC_KEY =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() ?? "";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> | null {
  if (!base64 || !/^[A-Za-z0-9_-]+$/.test(base64)) return null;
  try {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const base64Url = (base64 + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const raw = atob(base64Url);
    const buffer = new ArrayBuffer(raw.length);
    const array = new Uint8Array(buffer);
    for (let i = 0; i < raw.length; i++) array[i] = raw.charCodeAt(i);
    return array;
  } catch {
    return null;
  }
}

/** Browser capability + deployment configuration check. */
export async function pushSupported(): Promise<boolean> {
  const local =
    typeof location !== "undefined" &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1");
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    (window.isSecureContext || local) &&
    urlBase64ToUint8Array(VAPID_PUBLIC_KEY) !== null
  );
}

/** Subscribe this device and return the endpoint, or null if unavailable/denied. */
export async function subscribeToPush(): Promise<{
  endpoint: string;
  keys: { p256dh: string; auth: string };
} | null> {
  if (!(await pushSupported())) return null;

  const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  if (!applicationServerKey) return null;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    }));

  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (!p256dh || !auth) {
    await subscription.unsubscribe().catch(() => false);
    return null;
  }

  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
      auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
    },
  };
}

/** Unsubscribe this device (returns the endpoint so the server row can drop). */
export async function unsubscribeFromPush(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}

/** A rough device label, e.g. "Chrome · Mobile". */
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "Device";
  const ua = navigator.userAgent;
  const mobile = /iPhone|iPad|Android/i.test(ua);
  const browser = ua.includes("Edg")
    ? "Edge"
    : ua.includes("Chrome")
      ? "Chrome"
      : ua.includes("Firefox")
        ? "Firefox"
        : ua.includes("Safari")
          ? "Safari"
          : "Browser";
  return `${browser} · ${mobile ? "Mobile" : "Desktop"}`;
}
