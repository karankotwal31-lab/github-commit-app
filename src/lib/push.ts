/**
 * Client-side web push helpers.
 *
 * The VAPID public key is public by design (it's sent to the browser push
 * service); the matching private key lives server-side as VAPID_PRIVATE_KEY
 * in project keys. If the keys were rotated, replace both here and in keys.
 */
export const VAPID_PUBLIC_KEY =
  "BFTP0x0D0Y0EM96riQiggeKoYOURWclFvuzR9FRk4KJbols-6sfSUTk2j5xwJW9lR40931DSbUWAgZHRLmPFECM";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Url);
  const buffer = new ArrayBuffer(raw.length);
  const array = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) array[i] = raw.charCodeAt(i);
  return array;
}

/** True when the browser supports push and a service worker is registered. */
export async function pushSupported(): Promise<boolean> {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    (await navigator.serviceWorker.getRegistration()) !== undefined
  );
}

/** Subscribe this device and return the endpoint, or null if denied. */
export async function subscribeToPush(): Promise<{
  endpoint: string;
  keys: { p256dh: string; auth: string };
} | null> {
  const supported = await pushSupported();
  if (!supported) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: btoa(
        String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")!)),
      ),
      auth: btoa(
        String.fromCharCode(...new Uint8Array(subscription.getKey("auth")!)),
      ),
    },
  };
}

/** Unsubscribe this device (returns the endpoint so the server row drops). */
export async function unsubscribeFromPush(): Promise<string | null> {
  const supported = await pushSupported();
  if (!supported) return null;
  const registration = await navigator.serviceWorker.ready;
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
