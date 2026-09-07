/**
 * Shared network resilience for the backend: one fetch wrapper with automatic
 * retry (exponential backoff + jitter) used by every outbound call (GitHub
 * API, AI provider, OAuth token exchange).
 *
 * Retry policy — the "if a network call fails, retry it a few times before
 * giving up" layer of Aria:
 *   - network errors (fetch threw): retried, these are the flaky-WiFi case
 *   - 429 / 5xx: retried (429 honors Retry-After when present)
 *   - 4xx: NOT retried — a 404 or 403 won't become a 200 on the second try,
 *     and retrying a rejected write risks confusing error messages.
 *
 * Writes are retried too: GitHub's git APIs are sha/idempotent, so a lost
 * response after a successful write converges instead of duplicating.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number): number {
  // 400ms, 800ms, 1.6s, … capped at ~3s, plus jitter so a burst of failures
  // doesn't retry in lockstep.
  return (
    Math.min(3000, 400 * Math.pow(2, attempt - 1)) +
    Math.floor(Math.random() * 150)
  );
}

export interface FetchRetryOptions {
  /** Total attempts (1 = no retry). Default 3. */
  attempts?: number;
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  const safe = ["GET", "HEAD", "OPTIONS"].includes((init?.method ?? "GET").toUpperCase());
  const attempts = safe ? Math.max(1, options?.attempts ?? 3) : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) });
      if (res.status === 429 && attempt < attempts) {
        const retryAfter = res.headers.get("retry-after");
        const delayMs = retryAfter ? Number(retryAfter) * 1000 : backoffMs(attempt);
        await sleep(Number.isFinite(delayMs) ? Math.min(3000, Math.max(0, delayMs)) : backoffMs(attempt));
        continue;
      }
      if (res.status >= 500 && res.status < 600 && attempt < attempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

