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

let account: string | null = null;
const memory = new Map<string, string>();
const volatile = new Set<string>();
export function setOfflineAccount(userId: string | null) { account = userId; }
export function getOfflineAccount() { return account; }
function key(kind: string, userId = account): string {
  if (!userId) throw new Error("Sign in before saving offline work.");
  return `aria.offline.${kind}.v2:${encodeURIComponent(userId)}`;
}
function draftKey(d: { repo: string; branch: string; path: string }): string {
  return `${d.repo}\u0000${d.branch}\u0000${d.path}`;
}
function read<T>(kind: string, userId = account): T[] {
  if (!userId) return [];
  const k = key(kind, userId);
  try {
    const raw = volatile.has(k) ? memory.get(k) : globalThis.localStorage?.getItem(k) ?? memory.get(k);
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return JSON.parse(memory.get(k) ?? "[]"); }
}
function write<T>(kind: string, values: T[], userId = account) {
  const k = key(kind, userId), raw = JSON.stringify(values);
  memory.set(k, raw);
  try {
    if (!globalThis.localStorage) throw new Error("Storage unavailable");
    globalThis.localStorage.setItem(k, raw);
    volatile.delete(k);
  } catch {
    volatile.add(k);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("aria-storage-unavailable"));
  }
}
export function offlineStorageDurable() { return !account || ![...volatile].some(k => k.endsWith(`:${encodeURIComponent(account!)}`)); }
const readAll = (userId = account) => read<PendingDraft>("drafts", userId);
const writeAll = (drafts: PendingDraft[], userId = account) => write("drafts", drafts, userId);

/** Queue (or refresh) a failed draft save. Newest content wins per file. */
export function queueDraft(draft: PendingDraft, userId = account): void {
  const all = readAll(userId);
  const key = draftKey(draft);
  const without = all.filter((d) => draftKey(d) !== key);
  without.push(draft);
  // Keep newest N entries (they're sorted by recency of queueing).
  writeAll(without, userId);
}

/** All buffered drafts, newest first. */
export function pendingDrafts(): PendingDraft[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function pendingDraftCount(): number {
  return readAll().length;
}

/** Drop one buffered draft after it has been replayed (or committed). */
export function clearPendingDraft(repo: string, branch: string, path: string, updatedAt?: number): void {
  const key = `${repo}\u0000${branch}\u0000${path}`;
  writeAll(readAll().filter((d) => draftKey(d) !== key || (updatedAt !== undefined && d.updatedAt !== updatedAt)));
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
    contentBase64?: string;
    mode?: "100644" | "100755" | "120000";
    gitlink?: string;
    expectedSha?: string | null;
  }>;
  queuedAt: number;
}

const readCommits = (userId = account) => read<PendingCommit>("commits", userId);
const writeCommits = (commits: PendingCommit[], userId = account) => write("commits", commits, userId);

/** Queue a commit that couldn't reach the backend. Returns a stable id. */
export function queueCommit(commit: Omit<PendingCommit, "id" | "queuedAt">, userId = account): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const all = readCommits(userId);
  all.push({ ...commit, id, queuedAt: Date.now() });
  writeCommits(all, userId);
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
