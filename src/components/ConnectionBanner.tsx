import { useEffect, useState } from "react";
import { Loader2, WifiOff, RefreshCw } from "lucide-react";

/**
 * Persistent banner shown when the app detects network issues.
 * Self-healing: automatically hides when connection is restored.
 */
export function ConnectionBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const onOnline = () => {
      setReconnecting(true);
      // Brief delay to show "reconnected" state before hiding
      setTimeout(() => {
        setOnline(true);
        setReconnecting(false);
      }, 1500);
    };
    const onOffline = () => {
      setOnline(false);
      setReconnecting(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (online && !reconnecting) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium transition-colors ${
        reconnecting
          ? "bg-emerald-50 text-emerald-700 border-b border-emerald-200"
          : "bg-amber-50 text-amber-700 border-b border-amber-200"
      }`}
      role="alert"
    >
      {reconnecting ? (
        <>
          <RefreshCw className="size-3.5 animate-spin" />
          <span>Reconnected — syncing…</span>
        </>
      ) : (
        <>
          <WifiOff className="size-3.5" />
          <span>You're offline — edits are saved locally and will sync when you reconnect.</span>
        </>
      )}
    </div>
  );
}
