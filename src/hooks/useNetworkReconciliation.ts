import { useCallback, useEffect, useRef, useState } from "react";
import {
  pendingDrafts,
  clearPendingDraft,
  pendingDraftCount,
  type PendingDraft,
} from "@/lib/offlineBuffer";

/**
 * useNetworkReconciliation — the offline draft vault safeguard.
 *
 * Watches connectivity (navigator.onLine + online/offline events, re-checked
 * on visibilitychange for flaky connections) and, when the network returns,
 * replays the buffered drafts through `flush`. Replay is guarded against
 * concurrent runs and, via saveDraftIfNewer server-side, never overwrites a
 * fresher draft another device saved while this one was offline.
 *
 * The hook never throws — a failed replay simply leaves the buffer for the
 * next recovery event.
 */
export function useNetworkReconciliation(options: {
  /** Push one buffered draft. Called in sequence; rejects on failure. */
  push: (draft: PendingDraft) => Promise<void>;
  /** Skip a draft without pushing it (e.g. it was already committed). */
  canSkip?: (draft: PendingDraft) => boolean;
  enabled?: boolean;
  onSynced?: (count: number) => void;
  onOffline?: () => void;
}): {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
} {
  const { push, canSkip, enabled = true, onSynced, onOffline } = options;

  const [online, setOnline] = useState<boolean>(
    () => (typeof navigator !== "undefined" ? navigator.onLine : true),
  );
  const [pendingCount, setPendingCount] = useState<number>(() =>
    pendingDraftCount(),
  );
  const [syncing, setSyncing] = useState(false);

  // Keep the latest callbacks without re-subscribing listeners.
  const pushRef = useRef(push);
  pushRef.current = push;
  const canSkipRef = useRef(canSkip);
  canSkipRef.current = canSkip;
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;
  const onOfflineRef = useRef(onOffline);
  onOfflineRef.current = onOffline;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const flushingRef = useRef(false);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    const count = pendingDraftCount();
    if (count === 0) return;
    flushingRef.current = true;
    setSyncing(true);
    try {
      const drafts = pendingDrafts();
      let replayed = 0;
      for (const draft of drafts) {
        if (canSkipRef.current?.(draft)) {
          clearPendingDraft(draft.repo, draft.branch, draft.path);
          continue;
        }
        try {
          await pushRef.current(draft);
          clearPendingDraft(draft.repo, draft.branch, draft.path);
          replayed++;
        } catch {
          // Keep this draft queued — retry on the next recovery event.
          break;
        }
      }
      if (replayed > 0) onSyncedRef.current?.(replayed);
    } finally {
      flushingRef.current = false;
      setSyncing(false);
      setPendingCount(pendingDraftCount());
    }
  }, []);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      if (enabledRef.current) void flush();
    };
    const goOffline = () => {
      setOnline(false);
      onOfflineRef.current?.();
    };
    const recheck = () => {
      // visibilitychange re-syncs on flaky connections (blips where the
      // online event never fired but the tab just became visible again).
      if (document.visibilityState === "visible" && navigator.onLine) {
        setOnline(true);
        if (enabledRef.current) void flush();
      } else if (!navigator.onLine) {
        setOnline(false);
        onOfflineRef.current?.();
      }
      setPendingCount(pendingDraftCount());
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [flush]);

  // Initial reconciliation once mounted (e.g. page reloaded while online
  // with a stale buffer from a crashed session).
  useEffect(() => {
    if (enabled && navigator.onLine && pendingDraftCount() > 0) {
      void flush();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { online, pendingCount, syncing };
}
