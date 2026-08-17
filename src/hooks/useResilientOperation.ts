/**
 * Self-repairing operation wrapper.
 *
 * Wraps any async operation with:
 *  - Automatic retry on transient failure (network, 429, 5xx)
 *  - Exponential backoff with jitter
 *  - Error classification (retryable vs permanent)
 *  - Recovery state that the UI can render
 *
 * Usage:
 *   const { run, loading, error, retryCount, isRecovering } = useResilientOperation();
 *   await run(() => myConvexAction({ ... }));
 */
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

interface ResilientState {
  loading: boolean;
  error: string | null;
  retryCount: number;
  isRecovering: boolean;
}

interface ResilientOptions {
  /** Max retries before giving up. Default 3. */
  maxRetries?: number;
  /** Base delay in ms. Default 500. */
  baseDelayMs?: number;
  /** Show toast on error. Default true. */
  showToast?: boolean;
  /** Toast message prefix. */
  toastPrefix?: string;
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  // Network errors, timeouts, rate limits, server errors — all retryable
  if (msg.includes("network") || msg.includes("timeout") || msg.includes("fetch")) return true;
  if (msg.includes("429") || msg.includes("rate limit")) return true;
  if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;
  if (msg.includes("failed to fetch") || msg.includes("load failed")) return true;
  if (msg.includes("request failed") || msg.includes("aborted")) return true;
  return false;
}

function backoffMs(attempt: number, base: number): number {
  return Math.min(8000, base * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useResilientOperation(options?: ResilientOptions) {
  const { maxRetries = 3, baseDelayMs = 500, showToast = true, toastPrefix = "" } = options ?? {};
  const [state, setState] = useState<ResilientState>({
    loading: false,
    error: null,
    retryCount: 0,
    isRecovering: false,
  });
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Cleanup on unmount
  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    mountedRef.current = false;
  }, []);

  // Reset to clean state
  const reset = useCallback(() => {
    setState({ loading: false, error: null, retryCount: 0, isRecovering: false });
  }, []);

  const run = useCallback(
    async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      setState((s) => ({ ...s, loading: true, error: null, isRecovering: false }));

      let lastError: unknown;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (signal.aborted) return null;
        try {
          const result = await fn(signal);
          if (!signal.aborted) {
            setState({ loading: false, error: null, retryCount: 0, isRecovering: false });
          }
          return result;
        } catch (err) {
          lastError = err;
          if (signal.aborted) return null;

          if (attempt < maxRetries && isRetryableError(err)) {
            const delay = backoffMs(attempt, baseDelayMs);
            if (!signal.aborted) {
              setState((s) => ({
                ...s,
                retryCount: attempt,
                isRecovering: true,
                error: `Retrying… (attempt ${attempt + 1}/${maxRetries})`,
              }));
            }
            await sleep(delay);
            continue;
          }
          break;
        }
      }

      // Final failure
      const msg = lastError instanceof Error ? lastError.message : "An unexpected error occurred";
      if (!signal.aborted) {
        setState({ loading: false, error: msg, retryCount: 0, isRecovering: false });
        if (showToast) {
          toast.error(`${toastPrefix}${msg}`);
        }
      }
      return null;
    },
    [maxRetries, baseDelayMs, showToast, toastPrefix],
  );

  return { ...state, run, reset, cleanup };
}

/**
 * Checks if the browser is online and provides a reactive online status.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  // Note: we intentionally don't add cleanup for the event listeners here
  // because this hook lives for the app's lifetime. If you need cleanup,
  // use the cleanup from useResilientOperation instead.
  if (typeof window !== "undefined") {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    // Use a ref-based pattern to avoid double-subscribing in dev mode
    if (!(window as any).__aria_online_hooked) {
      (window as any).__aria_online_hooked = true;
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }
  }

  return online;
}
