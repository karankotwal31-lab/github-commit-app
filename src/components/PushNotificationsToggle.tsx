import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  deviceLabel,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push";
import { Bell, BellOff, Loader2 } from "lucide-react";

/**
 * Web-push toggle: enables notifications (permission + subscription stored
 * server-side), and while enabled polls the inbox check every 5 minutes so
 * PRs/issues land as notifications even if the user never opens the inbox.
 * The 24×7 cron covers the case where the tab is closed entirely.
 */
export function PushNotificationsToggle() {
  const config = useQuery(api.pushSubscriptions.pushConfig);
  const mySubs = useQuery(api.pushSubscriptions.myPushSubscriptions);
  const saveSub = useMutation(api.pushSubscriptions.savePushSubscription);
  const deleteSub = useMutation(api.pushSubscriptions.deletePushSubscription);
  const checkNotifications = useAction(api.notifications.checkNotifications);
  const [busy, setBusy] = useState(false);

  const enabled = (mySubs?.count ?? 0) > 0;
  const configured = config?.configured ?? false;

  // While enabled, poll the backend so new inbox items push promptly even
  // if the tab sits in the background. (Closed tabs are covered by the cron.)
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      checkNotifications().catch(() => {
        // Silent — the next tick retries.
      });
    }, 5 * 60 * 1000);
    checkNotifications().catch(() => {});
    return () => clearInterval(timer);
  }, [enabled, checkNotifications]);

  if (!configured) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (enabled) {
        const endpoint = await unsubscribeFromPush();
        if (endpoint) await deleteSub({ endpoint });
        toast.info("Notifications off for this device.");
      } else {
        const supported = await pushSupported();
        if (!supported) {
          toast.error(
            "Push isn't available in this browser — use a supported browser (or install Aria to your home screen on iOS).",
          );
          return;
        }
        const sub = await subscribeToPush();
        if (!sub) {
          toast.error("Permission denied — allow notifications to enable this.");
          return;
        }
        await saveSub({
          endpoint: sub.endpoint,
          keys: sub.keys,
          deviceLabel: deviceLabel(),
        });
        toast.success("Notifications on — PRs and issues will reach you here.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update notifications.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={
        enabled
          ? "Notifications on for this device — click to turn off"
          : "Turn on notifications for PRs and issues"
      }
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors disabled:opacity-50 ${
        enabled
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-neutral-200 text-neutral-500 hover:bg-neutral-100"
      }`}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : enabled ? (
        <Bell className="size-3.5" />
      ) : (
        <BellOff className="size-3.5" />
      )}
      <span className="hidden text-xs sm:inline">
        {enabled ? "Notifications on" : "Notifications"}
      </span>
    </button>
  );
}
