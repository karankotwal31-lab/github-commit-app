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

const MAX_DRAFTS_PER_ACCOUNT = 200;
const MAX_COMMITS_PER_ACCOUNT = 50;
const MAX_PENDING_PUSHES = 20;

let account: string | null = null;
const memory = new Map<string, string>();
const volatile = new Set<string>();

/**
 * Heuristic: does this error message indicate a network/connectivity
 * failure (as opposed to a real application-level rejection, e.g. a
 * conflict or a permissions error)? Shared here so every offline-queueing
 * call site (drafts, commits, pushes) classifies failures the same way
 * instead of each maintaining its own copy that could drift.
 */
export function isNetworkError(message: string): boolean {
  return /failed to fetch|networkerror|network error|offline|ecoconn|fetch failed|timeout|enetdown|socket hang up/i.test(
    message,
  );
}

export function setOfflineAccount(userId: string | null) {
  account = userId;
}

export function getOfflineAccount() {
  return account;
}

function key(kind: string, userId = account): string {
  if (!userId) throw new Error("Sign in before saving offline work.");
  return `aria.offline.${kind}.v2:${encodeURIComponent(userId)}`;
}

function draftKey(d: { repo: string; branch: string; path: string }): string {
  return `${d.repo}\u0000${d.branch}\u0000${d.path}`;
}

function parseArray<T>(raw: string | undefined | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function read<T>(kind: string, userId = account): T[] {
  if (!userId) return [];
  const storageKey = key(kind, userId);
  if (volatile.has(storageKey)) return parseArray<T>(memory.get(storageKey));
  try {
    return parseArray<T>(globalThis.localStorage?.getItem(storageKey) ?? memory.get(storageKey));
  } catch {
    return parseArray<T>(memory.get(storageKey));
  }
}

function write<T>(kind: string, values: T[], userId = account) {
  const storageKey = key(kind, userId);
  const raw = JSON.stringify(values);
  memory.set(storageKey, raw);
  try {
    if (!globalThis.localStorage) throw new Error("Storage unavailable");
    globalThis.localStorage.setItem(storageKey, raw);
    volatile.delete(storageKey);
  } catch {
    volatile.add(storageKey);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("aria-storage-unavailable"));
    }
  }
}

export function offlineStorageDurable() {
  if (!account) return false;
  const suffix = `:${encodeURIComponent(account)}`;
  return ![...volatile].some((storageKey) => storageKey.endsWith(suffix));
}

const readAll = (userId = account) => read<PendingDraft>("drafts", userId);
const writeAll = (drafts: PendingDraft[], userId = account) =>
  write("drafts", drafts, userId);

/** Queue (or refresh) a failed draft save. Newest content wins per file. */
export function queueDraft(draft: PendingDraft, userId = account): void {
  const all = readAll(userId);
  const targetKey = draftKey(draft);
  const without = all.filter((d) => draftKey(d) !== targetKey);
  without.push(draft);
  writeAll(without.slice(-MAX_DRAFTS_PER_ACCOUNT), userId);
}

/** All buffered drafts, newest first. */
export function pendingDrafts(): PendingDraft[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function pendingDraftCount(): number {
  return readAll().length;
}

/** Drop one buffered draft after it has been replayed (or committed). */
export function clearPendingDraft(
  repo: string,
  branch: string,
  path: string,
  updatedAt?: number,
): void {
  const targetKey = `${repo}\u0000${branch}\u0000${path}`;
  writeAll(
    readAll().filter(
      (d) =>
        draftKey(d) !== targetKey ||
        (updatedAt !== undefined && d.updatedAt !== updatedAt),
    ),
  );
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

const readCommits = (userId = account) =>
  read<PendingCommit>("commits", userId);
const writeCommits = (commits: PendingCommit[], userId = account) =>
  write("commits", commits, userId);

/** Queue a commit that couldn't reach the backend. Returns a stable id. */
export function queueCommit(
  commit: Omit<PendingCommit, "id" | "queuedAt">,
  userId = account,
): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const all = readCommits(userId);
  all.push({ ...commit, id, queuedAt: Date.now() });
  writeCommits(all.slice(-MAX_COMMITS_PER_ACCOUNT), userId);
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

// ---------------------------------------------------------------------------
// Offline push queue
//
// Merge and rebase run entirely against the local isomorphic-git object
// database (IndexedDB) and need no network at all -- only the final push to
// GitHub does. Previously a push that failed because the network dropped
// just threw, with no queue and no retry, unlike the commit flow above.
// Unlike commits, a pending push doesn't need to serialize any file content:
// the actual unpushed commits already live safely in the local git object
// database, so "replay" is just calling pushLocal again with the same
// owner/repo/branch once connectivity returns -- this queue only needs to
// remember that an unpushed push attempt exists.
// ---------------------------------------------------------------------------

export interface PendingPush {
  id: string;
  repo: string;
  branch: string;
  force?: boolean;
  allowSecrets?: boolean;
  queuedAt: number;
}

const readPushes = (userId = account) => read<PendingPush>("pushes", userId);
const writePushes = (pushes: PendingPush[], userId = account) =>
  write("pushes", pushes, userId);

/**
 * Queue a push that couldn't reach GitHub because the network dropped.
 * At most one pending push per repo+branch -- a newer attempt replaces an
 * older queued one rather than stacking duplicates that would just replay
 * the same underlying commits.
 */
export function queuePush(
  push: Omit<PendingPush, "id" | "queuedAt">,
  userId = account,
): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const all = readPushes(userId).filter(
    (p) => !(p.repo === push.repo && p.branch === push.branch),
  );
  all.push({ ...push, id, queuedAt: Date.now() });
  writePushes(all.slice(-MAX_PENDING_PUSHES), userId);
  return id;
}

/** All queued pushes, oldest first (replay order). */
export function pendingPushes(): PendingPush[] {
  return readPushes().sort((a, b) => a.queuedAt - b.queuedAt);
}

export function pendingPushCount(): number {
  return readPushes().length;
}

/** Drop a queued push after it has been replayed successfully. */
export function clearPendingPush(id: string): void {
  writePushes(readPushes().filter((p) => p.id !== id));
}

export function clearAllPendingPushes(): void {
  writePushes([]);
}
