/**
 * A staged pull-request draft: the AI review dialog writes its generated
 * title/body here, and the next "Open pull request" action reads it (falling
 * back to the commit message). Per-device by design — a convenience fill, not
 * a source of truth.
 */

const KEY = "aria.pr-draft.v1";

export interface PrDraft {
  title: string;
  body: string;
  savedAt: number;
}

export function savePrDraft(draft: PrDraft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable (private mode, quota) — fill simply won't apply.
  }
}

export function readPrDraft(): PrDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PrDraft;
    if (!parsed || typeof parsed.title !== "string" || !parsed.title) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPrDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore.
  }
}
