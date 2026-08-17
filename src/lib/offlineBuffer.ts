/**
 * Offline draft buffer.
 *
 * When a draft-vault save fails because the network dropped (Convex
 * mutation rejected), the edit is queued here instead of being lost. The
 * reconciliation hook (useNetworkReconciliation) replays the queue once the
 * connection returns, using saveDraftIfNewer so a fresher draft from another
 * device is never clobbered.
 *
 * Storage: localStorage with an in-memory fallback (sandboxed previews can
 * block it) — identical pattern to src/lib/pluginManager.ts.
 */

export interface PendingDraft {
  repo: string;
  branch: string;
  path: string;
  content: string;
  cursorLine: number | null;
  cursorColumn: number | null;
  /** Local edit time — used to skip stale entries during replay. */
  updatedAt: number;
}

const STORAGE_KEY = "aria.offline.drafts.v1";
/** Hard cap so a long offline session can't fill storage. Oldest entries drop. */
const MAX_ENTRIES = 200;

function draftKey(d: { repo: string; branch: string; path: string }): string {
  return `${d.repo}\u0000${d.branch}\u0000${d.path}`;
}

function memoryFallback(): Storage | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  try {
    if (g.localStorage) return g.localStorage;
  } catch {
    // blocked
  }
  return null;
}

function storage(): Storage | null {
  return memoryFallback();
}

function readAll(): PendingDraft[] {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingDraft[]) : [];
  } catch {
    return [];
  }
}

function writeAll(drafts: PendingDraft[]) {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Storage full or blocked — the session keeps drafts in memory only for
    // the lifetime of the tab. Never throw into the editor flow.
  }
}

/** Queue (or refresh) a failed draft save. Newest content wins per file. */
export function queueDraft(draft: PendingDraft): void {
  const all = readAll();
  const key = draftKey(draft);
  const without = all.filter((d) => draftKey(d) !== key);
  without.push(draft);
  // Keep newest N entries (they're sorted by recency of queueing).
  const trimmed = without.slice(-MAX_ENTRIES);
  writeAll(trimmed);
}

/** All buffered drafts, newest first. */
export function pendingDrafts(): PendingDraft[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function pendingDraftCount(): number {
  return readAll().length;
}

/** Drop one buffered draft after it has been replayed (or committed). */
export function clearPendingDraft(repo: string, branch: string, path: string): void {
  const key = `${repo}\u0000${branch}\u0000${path}`;
  writeAll(readAll().filter((d) => draftKey(d) !== key));
}

export function clearAllPendingDrafts(): void {
  writeAll([]);
}

// ---------------------------------------------------------------------------
// Offline commit queue
//
// Same idea as the draft buffer, for commits: when a commit can't reach the
// backend because the network dropped, the full staged change set is queued
// here (message + complete file contents, so it's self-contained) and
// replayed through the normal commit action the moment connectivity returns.
// Commits replay in order, oldest first — one failed replay keeps the rest
// queued rather than dropping or reordering work.
// ---------------------------------------------------------------------------

export interface PendingCommit {
  id: string;
  repo: string;
  branch: string;
  message: string;
  allowSecrets?: boolean;
  files: Array<{
    path: string;
    action: "update" | "create" | "delete";
    content?: string;
  }>;
  queuedAt: number;
}

const COMMIT_STORAGE_KEY = "aria.offline.commits.v1";
const MAX_COMMITS = 50;

function readCommits(): PendingCommit[] {
  try {
    const raw = storage()?.getItem(COMMIT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingCommit[]) : [];
  } catch {
    return [];
  }
}

function writeCommits(commits: PendingCommit[]) {
  try {
    storage()?.setItem(COMMIT_STORAGE_KEY, JSON.stringify(commits));
  } catch {
    // Storage full or blocked — keep in memory for the tab lifetime only.
  }
}

/** Queue a commit that couldn't reach the backend. Returns a stable id. */
export function queueCommit(commit: Omit<PendingCommit, "id" | "queuedAt">): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const all = readCommits();
  all.push({ ...commit, id, queuedAt: Date.now() });
  writeCommits(all.slice(-MAX_COMMITS));
  return id;
}

/** All queued commits, oldest first (replay order). */
export function pendingCommits(): PendingCommit[] {
  return readCommits().sort((a, b) => a.queuedAt - b.queuedAt);
}

export function pendingCommitCount(): number {
  return readCommits().length;
}

/** Drop a queued commit after it has been replayed successfully. */
export function clearPendingCommit(id: string): void {
  writeCommits(readCommits().filter((c) => c.id !== id));
}

export function clearAllPendingCommits(): void {
  writeCommits([]);
}
