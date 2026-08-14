/**
 * In-browser git engine for Aria.
 *
 * A real git repository (isomorphic-git) living in LightningFS in the
 * browser, populated through the GitHub REST API via Convex actions (the
 * OAuth token never leaves the backend, and GitHub's git-smart-HTTP endpoints
 * don't allow browser CORS). Local commits, merges, rebases, stashes and
 * cherry-picks all operate on real git objects; pushing translates local
 * commits into GitHub commits through the existing API actions.
 *
 * Known limitations (deliberately surfaced, never silent):
 * - "Clone" fetches the branch tip's full tree plus `depth` of history
 *   metadata. Blobs for older commits are fetched on demand (merge/rebase).
 * - Pushing replays local commits onto GitHub's current tip; after a rebase
 *   the ancestry on GitHub can differ from local (content is identical).
 * - Binary files can be staged/committed locally but are skipped during push.
 * - Submodules are skipped.
 */

import * as git from "isomorphic-git";
import LightningFS from "@isomorphic-git/lightning-fs";
import { threeWayMerge } from "./merge3";
import { secretRisk } from "./secrets";

// ---------------------------------------------------------------------------
// Backend abstraction (wired to Convex actions by the UI layer)
// ---------------------------------------------------------------------------

export interface GitPerson {
  name: string;
  email: string;
  date: string | null;
}

export interface CommitDetails {
  sha: string;
  treeSha: string | null;
  parents: string[];
  message: string;
  author: GitPerson;
  committer: GitPerson;
}

export interface GitBackend {
  listBranches(args: {
    owner: string;
    repo: string;
  }): Promise<Array<{ name: string; sha: string }>>;
  getCommitDetails(args: {
    owner: string;
    repo: string;
    sha: string;
  }): Promise<CommitDetails>;
  getTree(args: {
    owner: string;
    repo: string;
    treeSha: string;
  }): Promise<Array<{ path: string; mode: string; type: string; sha: string | null }>>;
  getBlob(args: {
    owner: string;
    repo: string;
    sha: string;
  }): Promise<{ content: string; size: number }>;
  commitChanges(args: {
    owner: string;
    repo: string;
    branch: string;
    message: string;
    allowSecrets?: boolean;
    files: Array<{
      path: string;
      content: string;
      action: "update" | "create" | "delete";
    }>;
  }): Promise<{ sha: string | null }>;
}

// ---------------------------------------------------------------------------
// Filesystem (IndexedDB, falling back to memory when the sandbox blocks it)
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/** A tiny in-memory backend implementing LightningFS's 5-method db contract
 *  (mirrors the package's own MemoryBackend — zero extra dependencies). */
class MemoryDb {
  private map = new Map<string | number, unknown>();
  saveSuperblock(superblock: unknown) {
    this.map.set("!root", superblock);
  }
  loadSuperblock(): unknown {
    return this.map.get("!root") ?? null;
  }
  readFile(inode: number): unknown {
    return this.map.get(inode) ?? null;
  }
  writeFile(inode: number, data: unknown) {
    this.map.set(inode, data);
  }
  unlink(inode: number) {
    this.map.delete(inode);
  }
  async wipe() {
    this.map.clear();
  }
  close() {}
}

let fsPromise: Promise<git.FsClient> | null = null;

function isStorageBlocked(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? "";
  return (
    name === "SecurityError" ||
    name === "InvalidStateError" ||
    name === "QuotaExceededError" ||
    /indexeddb|quota|security/i.test(String((error as Error)?.message ?? error))
  );
}

async function createFs(): Promise<git.FsClient> {
  const tryInit = async (fs: LightningFS): Promise<boolean> => {
    try {
      await fs.promises.mkdir("/");
      return true;
    } catch (e) {
      // EEXIST means the fs works; a security/quota error means it's blocked.
      if (isStorageBlocked(e)) return false;
      return true;
    }
  };

  const primary = new LightningFS("aria-git");
  if (await tryInit(primary)) {
    return primary as unknown as git.FsClient;
  }
  // Sandboxed preview (no IndexedDB): fall back to an in-memory fs. Data
  // survives for the lifetime of the tab only.
  const memory = new LightningFS("aria-git-mem", {
    db: new MemoryDb() as unknown as never,
  });
  await memory.promises.mkdir("/");
  return memory as unknown as git.FsClient;
}

export function getFs(): Promise<git.FsClient> {
  if (!fsPromise) fsPromise = createFs();
  return fsPromise;
}

export function repoPath(owner: string, repo: string): string {
  return `/aria/${owner}/${repo}`;
}

interface PromiseFsLike {
  promises: {
    readFile(p: string, o?: string | { encoding?: string }): Promise<string | Uint8Array>;
    writeFile(p: string, d: Uint8Array | string, o?: unknown): Promise<void>;
    unlink(p: string): Promise<void>;
    readdir(p: string): Promise<string[]>;
    mkdir(p: string, o?: unknown): Promise<void>;
    rmdir(p: string): Promise<void>;
    stat(p: string): Promise<{ isDirectory(): boolean; isFile(): boolean; size: number }>;
    lstat(p: string): Promise<unknown>;
    flush?(): Promise<void>;
  };
}

/** The promise-based fs facade (LightningFS is always promise-based here). */
export function promisesOf(fs: git.FsClient): PromiseFsLike["promises"] {
  return (fs as unknown as PromiseFsLike).promises;
}

export interface RepoCtx {
  fs: git.FsClient;
  pfs: PromiseFsLike["promises"];
  dir: string;
  gitdir: string;
}

export async function repoCtx(owner: string, repo: string): Promise<RepoCtx> {
  const fs = await getFs();
  const dir = repoPath(owner, repo);
  return { fs, pfs: promisesOf(fs), dir, gitdir: `${dir}/.git` };
}

export async function resetEngine() {
  fsPromise = null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function decodeText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function encodeText(text: string): Uint8Array {
  return encoder.encode(text);
}

export function isBinaryBytes(bytes: Uint8Array): boolean {
  const probe = bytes.subarray(0, 8000);
  for (let i = 0; i < probe.length; i++) {
    if (probe[i] === 0) return true;
  }
  return false;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function gitPerson(p: GitPerson): {
  name: string;
  email: string;
  timestamp: number;
  timezoneOffset: number;
} {
  let timestamp = Math.floor(Date.now() / 1000);
  let timezoneOffset = 0;
  if (p.date) {
    const d = new Date(p.date);
    if (!Number.isNaN(d.getTime())) {
      timestamp = Math.floor(d.getTime() / 1000);
      timezoneOffset = -d.getTimezoneOffset();
    }
  }
  return {
    name: p.name || "Aria",
    email: p.email || "aria@users.noreply.github.com",
    timestamp,
    timezoneOffset,
  };
}

/** Read the full recursive file map of a tree: path → { oid, mode }. */
export async function readTreeFiles(
  owner: string,
  repo: string,
  oid: string,
): Promise<Map<string, { oid: string; mode: string }>> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const map = new Map<string, { oid: string; mode: string }>();
  const stack: Array<{ oid: string; prefix: string }> = [{ oid, prefix: "" }];
  while (stack.length > 0) {
    const { oid: treeOid, prefix } = stack.pop()!;
    const { tree } = await git.readTree({ fs, dir, gitdir, oid: treeOid });
    for (const entry of tree) {
      const path = prefix ? `${prefix}/${entry.path}` : entry.path;
      if (entry.type === "tree") {
        stack.push({ oid: entry.oid, prefix: path });
      } else {
        map.set(path, { oid: entry.oid, mode: entry.mode });
      }
    }
  }
  return map;
}

/** Fetch missing blobs into the object DB, verifying content hashes. */
export async function ensureBlobs(
  backend: GitBackend,
  owner: string,
  repo: string,
  oids: Iterable<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const missing: string[] = [];
  for (const oid of oids) {
    try {
      await git.readBlob({ fs, dir, gitdir, oid });
    } catch {
      missing.push(oid);
    }
  }
  if (missing.length === 0) return;
  let done = 0;
  await mapLimit(missing, 6, async (oid) => {
    const data = await backend.getBlob({ owner, repo, sha: oid });
    const bytes = base64ToBytes(data.content);
    const hash = await git.hashBlob({ object: bytes });
    if (hash.oid !== oid) {
      throw new Error(
        `Content hash mismatch for ${oid.slice(0, 7)} — the file may have changed mid-fetch. Retry the operation.`,
      );
    }
    await git.writeBlob({ fs, dir, gitdir, blob: bytes });
    done++;
    onProgress?.(done, missing.length);
  });
}

/** Write a git tree from full-path entries; returns the root tree oid. */
export async function writeGitTree(
  owner: string,
  repo: string,
  entries: Array<{ path: string; mode: string; type: string; sha: string | null }>,
): Promise<string> {
  const { fs, gitdir } = await repoCtx(owner, repo);
  const dirMap = new Map<string, Map<string, { mode: string; sha: string; type: string }>>();
  for (const e of entries) {
    const parts = e.path.split("/");
    const name = parts.pop()!;
    const parent = parts.join("/");
    if (!dirMap.has(parent)) dirMap.set(parent, new Map());
    dirMap.get(parent)!.set(name, {
      mode: e.mode,
      sha: e.sha ?? "",
      type: e.type,
    });
  }
  const oidCache = new Map<string, string>();
  const depthOf = (dir: string) => (dir ? dir.split("/").length : 0);
  const sortedDirs = [...dirMap.keys()].sort((a, b) => depthOf(b) - depthOf(a));
  for (const dir of sortedDirs) {
    const children = dirMap.get(dir)!;
    const tree = [...children.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => ({
        mode: child.mode,
        path: name,
        type: child.type === "tree" ? ("tree" as const) : ("blob" as const),
        oid:
          child.type === "tree"
            ? oidCache.get(dir ? `${dir}/${name}` : name) ?? child.sha
            : child.sha,
      }));
    const oid = await git.writeTree({ fs, dir, gitdir, tree });
    oidCache.set(dir, oid);
  }
  const root = oidCache.get("");
  if (!root) throw new Error("Empty tree — nothing to write.");
  return root;
}

/** Write a file in the working tree, creating parent directories. */
export async function writeWorkFile(
  owner: string,
  repo: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const { pfs, dir } = await repoCtx(owner, repo);
  const parts = path.split("/");
  parts.pop();
  let current = dir;
  for (const part of parts) {
    current = `${current}/${part}`;
    try {
      await pfs.mkdir(current);
    } catch {
      // exists
    }
  }
  await pfs.writeFile(`${dir}/${path}`, bytes);
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

export interface CloneProgress {
  phase: string;
  done: number;
  total: number;
}

export interface CloneResult {
  branches: number;
  commits: number;
  files: number;
  durationMs: number;
  persisted: boolean;
}

export async function cloneRepo(
  backend: GitBackend,
  args: {
    owner: string;
    repo: string;
    branch: string;
    depth?: number;
    author: GitPerson;
    onProgress?: (progress: CloneProgress) => void;
  },
): Promise<CloneResult> {
  const { owner, repo, branch } = args;
  const depth = Math.max(1, Math.min(args.depth ?? 20, 100));
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const started = Date.now();

  args.onProgress?.({ phase: "initializing", done: 0, total: 1 });
  await git.init({ fs, dir, defaultBranch: branch });
  try {
    await git.setConfig({ fs, dir, path: "user.name", value: args.author.name });
  } catch {
    // best effort
  }
  try {
    await git.setConfig({ fs, dir, path: "user.email", value: args.author.email });
  } catch {
    // best effort
  }

  // Branch tips from GitHub.
  const branches = await backend.listBranches({ owner, repo });
  if (branches.length === 0) {
    throw new Error(`No branches found on ${owner}/${repo}.`);
  }
  const target = branches.find((b) => b.name === branch) ?? branches[0];

  // Walk commit history (all branches, depth-limited).
  const details = new Map<string, CommitDetails>();
  const queue: Array<{ sha: string; remaining: number }> = branches.map((b) => ({
    sha: b.sha,
    remaining: depth,
  }));
  let commits = 0;
  const treeShas = new Set<string>();
  while (queue.length > 0) {
    const { sha, remaining } = queue.shift()!;
    if (remaining <= 0 || details.has(sha)) continue;
    args.onProgress?.({ phase: "history", done: commits, total: -1 });
    let detail: CommitDetails;
    try {
      detail = await backend.getCommitDetails({ owner, repo, sha });
    } catch {
      continue; // shallow boundary / deleted commit — stop walking this line
    }
    details.set(sha, detail);
    commits++;
    if (detail.treeSha) treeShas.add(detail.treeSha);
    for (const parent of detail.parents.slice(0, 1)) {
      queue.push({ sha: parent, remaining: remaining - 1 });
    }
  }

  // Write commit objects (parents must be written first, so process oldest).
  args.onProgress?.({ phase: "commits", done: 0, total: details.size });
  let written = 0;
  for (const detail of details.values()) {
    const author = gitPerson(detail.author);
    const committer = gitPerson(detail.committer);
    await git.writeCommit({
      fs,
      dir,
      gitdir,
      commit: {
        message: detail.message,
        tree: detail.treeSha ?? "",
        parent: detail.parents,
        author,
        committer,
      },
    });
    written++;
    args.onProgress?.({ phase: "commits", done: written, total: details.size });
  }

  // Write tree objects.
  let treesDone = 0;
  for (const treeSha of treeShas) {
    const entries = await backend.getTree({ owner, repo, treeSha });
    const root = await writeGitTree(owner, repo, entries);
    if (root !== treeSha) {
      throw new Error(
        `Tree hash mismatch for ${treeSha.slice(0, 7)} — the clone data is inconsistent. Retry.`,
      );
    }
    treesDone++;
    args.onProgress?.({ phase: "trees", done: treesDone, total: treeShas.size });
  }

  // Branch refs.
  for (const b of branches) {
    await git.writeRef({
      fs,
      dir,
      gitdir,
      ref: `refs/remotes/origin/${b.name}`,
      value: b.sha,
      force: true,
    });
  }
  await git.writeRef({
    fs,
    dir,
    gitdir,
    ref: `refs/heads/${target.name}`,
    value: target.sha,
    force: true,
  });

  // Materialize the working tree of the branch we're on: fetch every blob in
  // its tip tree (the "shallow clone" cost), then check out.
  const tipDetail = details.get(target.sha);
  if (!tipDetail?.treeSha) {
    throw new Error("Couldn't resolve the branch tip tree for checkout.");
  }
  const tipTree = await readTreeFiles(owner, repo, tipDetail.treeSha);
  const blobOids = [...new Set([...tipTree.values()].map((e) => e.oid))];
  await ensureBlobs(backend, owner, repo, blobOids, (done, total) => {
    args.onProgress?.({ phase: "files", done, total });
  });

  await git.checkout({
    fs,
    dir,
    gitdir,
    ref: target.name,
    force: true,
    onProgress: (p) => {
      if (p.phase === "Writing file") {
        args.onProgress?.({ phase: "checkout", done: p.loaded, total: p.total });
      }
    },
  });

  // Persist the fs superblock so the clone survives a reload (IndexedDB only).
  let persisted = false;
  try {
    const fsAny = fs as unknown as { promises?: { flush?: () => Promise<void> } };
    await fsAny.promises?.flush?.();
    persisted = true;
  } catch {
    persisted = false;
  }

  return {
    branches: branches.length,
    commits,
    files: tipTree.size,
    durationMs: Date.now() - started,
    persisted,
  };
}

export async function localRepoExists(owner: string, repo: string): Promise<boolean> {
  try {
    const { pfs, dir } = await repoCtx(owner, repo);
    await pfs.stat(`${dir}/.git/HEAD`);
    return true;
  } catch {
    return false;
  }
}

export async function localBranchTip(
  owner: string,
  repo: string,
  branch: string,
): Promise<string | null> {
  try {
    const { fs, dir, gitdir } = await repoCtx(owner, repo);
    return await git.resolveRef({ fs, dir, gitdir, ref: `refs/heads/${branch}` });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status / stage / commit
// ---------------------------------------------------------------------------

export interface StatusRow {
  path: string;
  label: "untracked" | "modified" | "deleted" | "added";
  staged: boolean;
}

export async function getStatus(
  owner: string,
  repo: string,
): Promise<StatusRow[]> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const matrix = await git.statusMatrix({ fs, dir, gitdir });
  const rows: StatusRow[] = [];
  for (const [path, head, workdir, stage] of matrix) {
    if (head === 0 && workdir === 2 && stage === 0) {
      rows.push({ path, label: "untracked", staged: false });
    } else if (head === 1 && workdir === 2 && stage === 1) {
      rows.push({ path, label: "modified", staged: false });
    } else if (head === 1 && workdir === 0 && stage === 1) {
      rows.push({ path, label: "deleted", staged: false });
    } else if (head === 0 && workdir === 2 && stage === 2) {
      rows.push({ path, label: "added", staged: true });
    } else if (head === 1 && workdir === 2 && stage === 2) {
      rows.push({ path, label: "modified", staged: true });
    } else if (head === 1 && workdir === 0 && stage === 0) {
      rows.push({ path, label: "deleted", staged: true });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export async function stageFile(
  owner: string,
  repo: string,
  path: string,
): Promise<void> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const status = await git.status({ fs, dir, gitdir, filepath: path });
  if (status === "*deleted" || status === "*absent") {
    await git.remove({ fs, dir, gitdir, filepath: path });
  } else {
    await git.add({ fs, dir, gitdir, filepath: path });
  }
}

export async function unstageFile(
  owner: string,
  repo: string,
  path: string,
): Promise<void> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  await git.resetIndex({ fs, dir, gitdir, filepath: path });
}


export interface LocalCommitInput {
  owner: string;
  repo: string;
  message: string;
  author: GitPerson;
  allowSecrets?: boolean;
}

export async function commitLocal(
  input: LocalCommitInput,
): Promise<{ oid: string; message: string }> {
  const { owner, repo } = input;
  const { fs, pfs, dir, gitdir } = await repoCtx(owner, repo);
  const status = await getStatus(owner, repo);
  const staged = status.filter((r) => r.staged);
  if (staged.length === 0) {
    throw new Error("Nothing is staged — stage a change first.");
  }
  if (!input.message.trim()) {
    throw new Error("A commit message is required.");
  }
  // Secret guardrails mirror the server-side check.
  for (const row of staged) {
    if (row.label === "deleted") continue;
    const bytes = (await pfs.readFile(`${dir}/${row.path}`)) as Uint8Array;
    if (isBinaryBytes(bytes)) continue;
    const risk = secretRisk(row.path, decodeText(bytes));
    if (risk.risky && !input.allowSecrets) {
      throw new Error(
        `${row.path} looks like it contains secrets — Aria won't commit it without confirmation.`,
      );
    }
  }
  const person = gitPerson(input.author);
  const oid = await git.commit({
    fs,
    dir,
    gitdir,
    message: input.message,
    author: person,
    committer: person,
  });
  return { oid, message: input.message };
}

// ---------------------------------------------------------------------------
// Push (local commits → GitHub via API)
// ---------------------------------------------------------------------------

export interface PushResult {
  pushed: number;
  skippedBinary: string[];
  finalSha: string | null;
  replayed: boolean;
}

export async function pushLocal(
  backend: GitBackend,
  args: {
    owner: string;
    repo: string;
    branch: string;
    allowSecrets?: boolean;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<PushResult> {
  const { owner, repo, branch } = args;
  const { fs, dir, gitdir } = await repoCtx(owner, repo);

  const current = await git.currentBranch({ fs, dir, gitdir, fullname: false });
  if (!current || current !== branch) {
    throw new Error(
      current
        ? `HEAD is on ${current}, not ${branch}. Check out ${branch} first.`
        : "HEAD is detached — check out a branch before pushing.",
    );
  }
  const localTip = await git.resolveRef({ fs, dir, gitdir, ref: `refs/heads/${branch}` });

  const remoteBranches = await backend.listBranches({ owner, repo });
  const remote = remoteBranches.find((b) => b.name === branch);
  if (!remote) {
    throw new Error(
      `${branch} doesn't exist on GitHub yet. Create it from the workspace first.`,
    );
  }
  const remoteTip = remote.sha;

  // Commits to push: walk local history until we hit the remote tip.
  const log = await git.log({ fs, dir, gitdir, ref: `refs/heads/${branch}`, depth: 500 });
  const remoteIndex = log.findIndex((c) => c.oid === remoteTip);
  const toPush = remoteIndex >= 0 ? log.slice(0, remoteIndex) : log;
  if (toPush.length === 0) {
    return { pushed: 0, skippedBinary: [], finalSha: localTip, replayed: false };
  }
  // Oldest first.
  toPush.reverse();

  const skippedBinary: string[] = [];
  let pushed = 0;
  let finalSha: string | null = remoteTip;

  for (const entry of toPush) {
    const commit = (await git.readCommit({ fs, dir, gitdir, oid: entry.oid })).commit;
    // Root commit (no parent): everything is a create against an empty tree.
    const parentMap = commit.parent[0]
      ? await readTreeFiles(owner, repo, commit.parent[0])
      : new Map<string, { oid: string; mode: string }>();
    const commitTree = await readTreeFiles(owner, repo, commit.tree);
    const parentTree = parentMap;

    const changed: Array<{ path: string; action: "update" | "create" | "delete" }> = [];
    for (const [path, e] of commitTree) {
      const p = parentTree.get(path);
      if (!p || p.oid !== e.oid || p.mode !== e.mode) {
        changed.push({ path, action: p ? "update" : "create" });
      }
    }
    for (const [path] of parentTree) {
      if (!commitTree.has(path)) changed.push({ path, action: "delete" });
    }
    if (changed.length === 0) continue;

    const files: Array<{
      path: string;
      content: string;
      action: "update" | "create" | "delete";
    }> = [];
    for (const change of changed) {
      if (change.action === "delete") {
        files.push({ path: change.path, content: "", action: "delete" });
        continue;
      }
      const blobOid = commitTree.get(change.path)!.oid;
      const blob = await git.readBlob({ fs, dir, gitdir, oid: blobOid });
      if (isBinaryBytes(blob.blob)) {
        skippedBinary.push(change.path);
        continue; // binary files can't round-trip through the API text path
      }
      files.push({
        path: change.path,
        content: decodeText(blob.blob),
        action: change.action,
      });
    }
    if (files.length === 0) continue;

    await backend.commitChanges({
      owner,
      repo,
      branch,
      message: commit.message,
      allowSecrets: args.allowSecrets,
      files,
    });
    pushed++;
    finalSha = (await backend.listBranches({ owner, repo })).find(
      (b) => b.name === branch,
    )?.sha ?? finalSha;
    args.onProgress?.(pushed, toPush.length);
  }

  try {
    await git.writeRef({
      fs,
      dir,
      gitdir,
      ref: `refs/remotes/origin/${branch}`,
      value: localTip,
      force: true,
    });
  } catch {
    // best effort
  }

  return {
    pushed,
    skippedBinary,
    finalSha,
    replayed: remoteIndex < 0,
  };
}

// ---------------------------------------------------------------------------
// Merge + conflict sessions
// ---------------------------------------------------------------------------

export interface ConflictFile {
  path: string;
  base: Uint8Array | null;
  ours: Uint8Array | null;
  theirs: Uint8Array | null;
  binary: boolean;
  resolved: boolean;
}

export interface RebaseTodo {
  oid: string;
  message: string;
  author: GitPerson;
  action: "pick" | "squash" | "reword" | "drop";
}

export type GitSession =
  | {
      kind: "merge";
      branch: string;
      theirs: string;
      theirsOid: string;
      originalTip: string;
      files: ConflictFile[];
    }
  | {
      kind: "rebase";
      branch: string;
      baseOid: string;
      originalTip: string;
      todos: RebaseTodo[];
      index: number;
      squashMessage: string | null;
      files: ConflictFile[];
    }
  | {
      kind: "cherry-pick";
      branch: string;
      oid: string;
      originalTip: string;
      files: ConflictFile[];
    };

let activeSession: GitSession | null = null;

export function getActiveSession(): GitSession | null {
  return activeSession;
}

export function clearActiveSession() {
  activeSession = null;
}

function markFileResolved(session: GitSession, path: string) {
  const file = session.files.find((f) => f.path === path);
  if (file) file.resolved = true;
}

/** Compute the three-way content for one path across base/ours/theirs trees. */
async function conflictEntry(
  owner: string,
  repo: string,
  path: string,
  baseMap: Map<string, { oid: string; mode: string }>,
  oursMap: Map<string, { oid: string; mode: string }>,
  theirsMap: Map<string, { oid: string; mode: string }>,
): Promise<ConflictFile> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const read = async (
    map: Map<string, { oid: string; mode: string }>,
  ): Promise<Uint8Array | null> => {
    const entry = map.get(path);
    if (!entry) return null;
    const blob = await git.readBlob({ fs, dir, gitdir, oid: entry.oid });
    return blob.blob;
  };
  const base = await read(baseMap);
  const ours = await read(oursMap);
  const theirs = await read(theirsMap);
  const binary =
    (base !== null && isBinaryBytes(base)) ||
    (ours !== null && isBinaryBytes(ours)) ||
    (theirs !== null && isBinaryBytes(theirs));
  return { path, base, ours, theirs, binary, resolved: false };
}

async function ensureTreeBlobs(
  backend: GitBackend,
  owner: string,
  repo: string,
  trees: Map<string, { oid: string; mode: string }>[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const oids = new Set<string>();
  for (const tree of trees) {
    for (const entry of tree.values()) oids.add(entry.oid);
  }
  await ensureBlobs(backend, owner, repo, oids, onProgress);
}

export type MergeOutcome =
  | { type: "clean"; oid?: string; fastForward?: boolean; alreadyMerged?: boolean; mergeCommit?: boolean }
  | { type: "conflicts"; files: ConflictFile[] };

export async function mergeBranch(
  backend: GitBackend,
  args: {
    owner: string;
    repo: string;
    theirs: string;
    message: string;
    author: GitPerson;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<MergeOutcome> {
  const { owner, repo, theirs } = args;
  const { fs, dir, gitdir } = await repoCtx(owner, repo);

  const branch = await git.currentBranch({ fs, dir, gitdir, fullname: false });
  if (!branch) throw new Error("HEAD is detached — check out a branch to merge into.");
  if (branch === theirs) throw new Error("Can't merge a branch into itself.");

  const oursOid = await git.resolveRef({ fs, dir, gitdir, ref: `refs/heads/${branch}` });
  const theirsOid = await git.resolveRef({ fs, dir, gitdir, ref: `refs/heads/${theirs}` });
  const bases = await git.findMergeBase({ fs, dir, gitdir, oids: [oursOid, theirsOid] });
  const baseOid = bases[0];
  if (!baseOid) throw new Error("No merge base — the branches have unrelated histories.");

  const [baseMap, oursMap, theirsMap] = await Promise.all([
    readTreeFiles(owner, repo, baseOid),
    readTreeFiles(owner, repo, oursOid),
    readTreeFiles(owner, repo, theirsOid),
  ]);
  await ensureTreeBlobs(backend, owner, repo, [baseMap, oursMap, theirsMap], args.onProgress);

  const person = gitPerson(args.author);
  try {
    const result = await git.merge({
      fs,
      dir,
      gitdir,
      ours: branch,
      theirs,
      abortOnConflict: true,
      message: args.message,
      author: person,
      committer: person,
    });
    return {
      type: "clean",
      oid: result.oid,
      fastForward: result.fastForward,
      alreadyMerged: result.alreadyMerged,
      mergeCommit: result.mergeCommit,
    };
  } catch (error) {
    if (error instanceof git.Errors.MergeConflictError) {
      const files: ConflictFile[] = [];
      for (const path of error.data.filepaths) {
        files.push(
          await conflictEntry(owner, repo, path, baseMap, oursMap, theirsMap),
        );
      }
      activeSession = {
        kind: "merge",
        branch,
        theirs,
        theirsOid,
        originalTip: oursOid,
        files,
      };
      return { type: "conflicts", files };
    }
    throw error;
  }
}

/** Mark a conflicted file as resolved with explicit content (null = deleted). */
export async function resolveConflictFile(
  owner: string,
  repo: string,
  path: string,
  content: Uint8Array | null,
): Promise<void> {
  const session = activeSession;
  if (!session) throw new Error("No operation in progress.");
  const { fs, pfs, dir, gitdir } = await repoCtx(owner, repo);
  if (content === null) {
    try {
      await pfs.unlink(`${dir}/${path}`);
    } catch {
      // already gone
    }
    await git.remove({ fs, dir, gitdir, filepath: path });
  } else {
    await writeWorkFile(owner, repo, path, content);
    await git.add({ fs, dir, gitdir, filepath: path });
  }
  markFileResolved(session, path);
}

export function allResolved(): boolean {
  return activeSession !== null && activeSession.files.every((f) => f.resolved);
}

export async function finishMerge(
  args: { owner: string; repo: string; message: string; author: GitPerson },
): Promise<string> {
  const session = activeSession;
  if (!session || session.kind !== "merge") {
    throw new Error("No merge in progress.");
  }
  if (!allResolved()) throw new Error("Not all conflicts are resolved yet.");
  const { fs, dir, gitdir } = await repoCtx(args.owner, args.repo);
  const person = gitPerson(args.author);
  const oid = await git.commit({
    fs,
    dir,
    gitdir,
    message: args.message,
    author: person,
    committer: person,
    parent: [session.originalTip, session.theirsOid],
  });
  clearActiveSession();
  return oid;
}

export async function abortSession(
  args: { owner: string; repo: string },
): Promise<void> {
  const session = activeSession;
  if (!session) return;
  const { fs, dir, gitdir } = await repoCtx(args.owner, args.repo);
  if (session.kind === "merge") {
    try {
      await git.abortMerge({ fs, dir, gitdir });
    } catch {
      // nothing to abort
    }
    await git.checkout({ fs, dir, gitdir, ref: session.branch, force: true });
  } else {
    const branch = session.branch;
    await git.branch({
      fs,
      dir,
      gitdir,
      ref: branch,
      object: session.originalTip,
      force: true,
      checkout: false,
    });
    await git.checkout({ fs, dir, gitdir, ref: branch, force: true });
  }
  clearActiveSession();
}

// ---------------------------------------------------------------------------
// Rebase (interactive, manual replay) + cherry-pick
// ---------------------------------------------------------------------------

export interface RebasePlan {
  todos: RebaseTodo[];
  autoDroppedMerges: number;
}

export async function startRebase(
  args: { owner: string; repo: string; base: string },
): Promise<RebasePlan> {
  const { owner, repo, base } = args;
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const branch = await git.currentBranch({ fs, dir, gitdir, fullname: false });
  if (!branch) throw new Error("HEAD is detached — check out a branch to rebase.");
  if (branch === base) throw new Error("Can't rebase a branch onto itself.");

  const status = await getStatus(owner, repo);
  if (status.length > 0) {
    throw new Error(
      `Working tree is dirty (${status.length} change${status.length > 1 ? "s" : ""}) — commit or stash before rebasing.`,
    );
  }

  const baseOid = await git.resolveRef({ fs, dir, gitdir, ref: `refs/heads/${base}` });
  const branchLog = await git.log({ fs, dir, gitdir, ref: `refs/heads/${branch}`, depth: 500 });
  const baseLog = await git.log({ fs, dir, gitdir, ref: `refs/heads/${base}`, depth: 500 });
  const baseSet = new Set(baseLog.map((c) => c.oid));

  const toReplay = branchLog.filter((c) => !baseSet.has(c.oid));
  if (toReplay.length === 0) {
    throw new Error(`${branch} is already up to date with ${base}.`);
  }
  let autoDroppedMerges = 0;
  const todos: RebaseTodo[] = [];
  // Oldest first.
  for (const entry of [...toReplay].reverse()) {
    const commit = (await git.readCommit({ fs, dir, gitdir, oid: entry.oid })).commit;
    if (commit.parent.length > 1) {
      autoDroppedMerges++;
      continue; // merge commits are linearized away, like real git rebase
    }
    todos.push({
      oid: entry.oid,
      message: commit.message,
      author: {
        name: commit.author.name ?? "Aria",
        email: commit.author.email ?? "aria@users.noreply.github.com",
        date: null,
      },
      action: "pick",
    });
  }
  if (todos.length === 0) {
    throw new Error("Only merge commits would be replayed — nothing to rebase.");
  }

  // Move the branch onto the base, refresh the working tree.
  await git.branch({
    fs,
    dir,
    gitdir,
    ref: branch,
    object: baseOid,
    force: true,
    checkout: false,
  });
  await git.checkout({ fs, dir, gitdir, ref: branch, force: true });

  activeSession = {
    kind: "rebase",
    branch,
    baseOid,
    originalTip: branchLog[0].oid,
    todos,
    index: 0,
    squashMessage: null,
    files: [],
  };
  return { todos, autoDroppedMerges };
}

/** Apply one commit's changes onto HEAD using three-way merges. */
async function applyCommitChanges(
  backend: GitBackend,
  owner: string,
  repo: string,
  commitOid: string,
): Promise<ConflictFile[] | null> {
  const { fs, pfs, dir, gitdir } = await repoCtx(owner, repo);
  const commit = (await git.readCommit({ fs, dir, gitdir, oid: commitOid })).commit;
  const parentOid = commit.parent[0];
  const headOid = await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" });

  const [parentMap, commitMap, headMap] = await Promise.all([
    readTreeFiles(owner, repo, parentOid),
    readTreeFiles(owner, repo, commit.tree),
    readTreeFiles(owner, repo, headOid),
  ]);

  const changed = new Set<string>();
  for (const [path, e] of commitMap) {
    const p = parentMap.get(path);
    if (!p || p.oid !== e.oid || p.mode !== e.mode) changed.add(path);
  }
  for (const [path] of parentMap) {
    if (!commitMap.has(path)) changed.add(path);
  }
  if (changed.size === 0) return null;

  const needed = new Set<string>();
  for (const path of changed) {
    for (const map of [parentMap, commitMap, headMap]) {
      const e = map.get(path);
      if (e) needed.add(e.oid);
    }
  }
  await ensureBlobs(backend, owner, repo, needed);

  const conflicts: ConflictFile[] = [];
  const read = async (
    path: string,
    map: Map<string, { oid: string; mode: string }>,
  ): Promise<Uint8Array | null> => {
    const e = map.get(path);
    if (!e) return null;
    return (await git.readBlob({ fs, dir, gitdir, oid: e.oid })).blob;
  };

  for (const path of changed) {
    const base = await read(path, parentMap);
    const ours = await read(path, headMap);
    const theirs = await read(path, commitMap);

    if (ours !== null && theirs !== null && bytesEqual(ours, theirs)) {
      // Ours already matches theirs — nothing to do.
      continue;
    }
    const binary =
      (base !== null && isBinaryBytes(base)) ||
      (ours !== null && isBinaryBytes(ours)) ||
      (theirs !== null && isBinaryBytes(theirs));

    if (binary) {
      // Clean binary cases: one side didn't touch the file.
      if (base !== null && ours !== null && bytesEqual(base, ours)) {
        // Ours is unchanged — take theirs (or their deletion).
        if (theirs === null) {
          try { await pfs.unlink(`${dir}/${path}`); } catch { /* gone */ }
          await git.remove({ fs, dir, gitdir, filepath: path });
        } else {
          await writeWorkFile(owner, repo, path, theirs);
          await git.add({ fs, dir, gitdir, filepath: path });
        }
        continue;
      }
      if (base !== null && theirs !== null && bytesEqual(base, theirs)) {
        // Theirs is unchanged — keep ours as is.
        continue;
      }
      if (base === null && ours === null && theirs !== null) {
        // Brand new file from the commit, absent on our side — clean add.
        await writeWorkFile(owner, repo, path, theirs);
        await git.add({ fs, dir, gitdir, filepath: path });
        continue;
      }
      // Add/add, delete/modify, or modify/modify on binary data — the user
      // picks a whole side.
      conflicts.push({ path, base, ours, theirs, binary: true, resolved: false });
      continue;
    }

    const merged = threeWayMerge(
      base === null ? "" : decodeText(base),
      ours === null ? "" : decodeText(ours),
      theirs === null ? "" : decodeText(theirs),
    );
    if (merged.clean) {
      if (theirs === null) {
        // The commit deletes this file and the merge stayed clean (we either
        // didn't touch it or deleted it too) — remove it.
        try { await pfs.unlink(`${dir}/${path}`); } catch { /* gone */ }
        await git.remove({ fs, dir, gitdir, filepath: path });
      } else {
        const resolvedBytes = encodeText(merged.result.join("\n"));
        await writeWorkFile(owner, repo, path, resolvedBytes);
        await git.add({ fs, dir, gitdir, filepath: path });
      }
    } else {
      conflicts.push({ path, base, ours, theirs, binary: false, resolved: false });
    }
  }
  return conflicts.length > 0 ? conflicts : null;
}

async function commitRebaseStep(
  owner: string,
  repo: string,
  author: GitPerson,
  session: Extract<GitSession, { kind: "rebase" }>,
): Promise<void> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const todo = session.todos[session.index];
  if (todo.action === "squash") {
    // Fold into the next commit: keep staged, remember the message.
    session.squashMessage = todo.message.split("\n")[0];
    session.index++;
    return;
  }
  const commit = (await git.readCommit({ fs, dir, gitdir, oid: todo.oid })).commit;
  let message = todo.action === "reword" && todo.message ? todo.message : commit.message;
  if (session.squashMessage) {
    message = `${session.squashMessage}\n\n${message}`;
    session.squashMessage = null;
  }
  const person = gitPerson(todo.author);
  await git.commit({
    fs,
    dir,
    gitdir,
    message,
    author: person,
    committer: person,
  });
  session.index++;
}

export type RebaseOutcome =
  | { conflict: false; commits: number; done: boolean }
  | { conflict: true; step: number; files: ConflictFile[] };

/** Run the rebase from the session's current index. */
export async function runRebase(
  backend: GitBackend,
  args: { owner: string; repo: string },
): Promise<RebaseOutcome> {
  const { owner, repo } = args;
  const session = activeSession;
  if (!session || session.kind !== "rebase") {
    throw new Error("No rebase in progress.");
  }
  const { fs, dir, gitdir } = await repoCtx(owner, repo);

  // Resuming after conflicts: commit the current step first.
  if (session.files.length > 0) {
    if (!session.files.every((f) => f.resolved)) {
      throw new Error("Not all conflicts are resolved yet.");
    }
    await commitRebaseStep(owner, repo, session.todos[session.index].author, session);
    session.files = [];
  }

  let committed = 0;
  while (session.index < session.todos.length) {
    const todo = session.todos[session.index];
    if (todo.action === "drop") {
      session.index++;
      continue;
    }
    const conflicts = await applyCommitChanges(backend, owner, repo, todo.oid);
    if (conflicts) {
      session.files = conflicts;
      return { conflict: true, step: session.index, files: conflicts };
    }
    await commitRebaseStep(owner, repo, session.todos[session.index].author, session);
    committed++;
  }

  // A trailing squash never got committed — commit its staged changes.
  if (session.squashMessage) {
    const person = gitPerson(session.todos[session.todos.length - 1].author);
    await git.commit({
      fs,
      dir,
      gitdir,
      message: session.squashMessage,
      author: person,
      committer: person,
    });
    committed++;
    session.squashMessage = null;
  }

  clearActiveSession();
  return { conflict: false, commits: committed, done: true };
}

export function rebaseTodoCount(): number {
  const s = activeSession;
  return s && s.kind === "rebase" ? s.todos.length : 0;
}

// ---------------------------------------------------------------------------
// Cherry-pick (manual replay of a single commit)
// ---------------------------------------------------------------------------

export type CherryPickOutcome =
  | { conflict: false; oid: string | null }
  | { conflict: true; files: ConflictFile[] };

export async function cherryPickCommit(
  backend: GitBackend,
  args: { owner: string; repo: string; oid: string },
): Promise<CherryPickOutcome> {
  const { owner, repo, oid } = args;
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const branch = await git.currentBranch({ fs, dir, gitdir, fullname: false });
  if (!branch) throw new Error("HEAD is detached — check out a branch to cherry-pick onto.");

  const originalTip = await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" });
  const conflicts = await applyCommitChanges(backend, owner, repo, oid);
  if (conflicts) {
    activeSession = { kind: "cherry-pick", branch, oid, originalTip, files: conflicts };
    return { conflict: true, files: conflicts };
  }

  const commit = (await git.readCommit({ fs, dir, gitdir, oid })).commit;
  const person = gitPerson({
    name: commit.author.name ?? "Aria",
    email: commit.author.email ?? "aria@users.noreply.github.com",
    date: null,
  });
  const newOid = await git.commit({
    fs,
    dir,
    gitdir,
    message: commit.message,
    author: person,
    committer: person,
  });
  return { conflict: false, oid: newOid };
}

export async function finishCherryPick(
  args: { owner: string; repo: string },
): Promise<string> {
  const session = activeSession;
  if (!session || session.kind !== "cherry-pick") {
    throw new Error("No cherry-pick in progress.");
  }
  if (!allResolved()) throw new Error("Not all conflicts are resolved yet.");
  const { fs, dir, gitdir } = await repoCtx(args.owner, args.repo);
  const commit = (await git.readCommit({ fs, dir, gitdir, oid: session.oid })).commit;
  const person = gitPerson({
    name: commit.author.name ?? "Aria",
    email: commit.author.email ?? "aria@users.noreply.github.com",
    date: null,
  });
  const oid = await git.commit({
    fs,
    dir,
    gitdir,
    message: commit.message,
    author: person,
    committer: person,
  });
  clearActiveSession();
  return oid;
}

// ---------------------------------------------------------------------------
// Stash (built into isomorphic-git)
// ---------------------------------------------------------------------------

export interface StashEntry {
  index: number;
  label: string;
}

export async function stashPush(
  owner: string,
  repo: string,
  message: string,
): Promise<void> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  await git.stash({ fs, dir, gitdir, op: "push", message });
}

export async function stashList(owner: string, repo: string): Promise<StashEntry[]> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const list = (await git.stash({ fs, dir, gitdir, op: "list" })) as string[] | undefined;
  return (list ?? []).map((label, index) => ({ index, label }));
}

export async function stashPop(
  owner: string,
  repo: string,
  index: number,
): Promise<void> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  await git.stash({ fs, dir, gitdir, op: "pop", refIdx: index });
}

export async function stashDrop(
  owner: string,
  repo: string,
  index: number,
): Promise<void> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  await git.stash({ fs, dir, gitdir, op: "drop", refIdx: index });
}

export async function stashClear(owner: string, repo: string): Promise<void> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  await git.stash({ fs, dir, gitdir, op: "clear" });
}

// ---------------------------------------------------------------------------
// Commit graph
// ---------------------------------------------------------------------------

export interface GraphCommit {
  oid: string;
  message: string;
  author: string;
  date: number;
  parents: string[];
}

export interface GraphData {
  commits: GraphCommit[];
  branches: Array<{ name: string; oid: string }>;
  headOid: string | null;
  headBranch: string | null;
  detached: boolean;
}

const BRANCH_COLORS = [
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#6366f1",
];

export function branchColor(index: number): string {
  return BRANCH_COLORS[index % BRANCH_COLORS.length];
}

export async function getGraph(
  owner: string,
  repo: string,
  depth = 150,
): Promise<GraphData> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const branches = await git.listBranches({ fs, dir, gitdir });
  const byOid = new Map<string, GraphCommit>();
  const refs: Array<{ name: string; oid: string }> = [];

  for (const name of branches) {
    let oid: string;
    try {
      oid = await git.resolveRef({ fs, dir, gitdir, ref: `refs/heads/${name}` });
    } catch {
      continue;
    }
    refs.push({ name, oid });
    const log = await git.log({ fs, dir, gitdir, ref: `refs/heads/${name}`, depth });
    for (const entry of log) {
      if (byOid.has(entry.oid)) continue;
      const commit = (await git.readCommit({ fs, dir, gitdir, oid: entry.oid })).commit;
      byOid.set(entry.oid, {
        oid: entry.oid,
        message: commit.message,
        author: commit.author.name ?? "unknown",
        date: (commit.author.timestamp ?? 0) * 1000,
        parents: commit.parent,
      });
    }
  }

  let headOid: string | null = null;
  let headBranch: string | null = null;
  let detached = false;
  try {
    headBranch = (await git.currentBranch({ fs, dir, gitdir, fullname: false })) || null;
    headOid = await git.resolveRef({ fs, dir, gitdir, ref: "HEAD" });
    detached = headBranch === null;
  } catch {
    // no commits yet
  }

  return {
    commits: [...byOid.values()].sort((a, b) => b.date - a.date),
    branches: refs,
    headOid,
    headBranch,
    detached,
  };
}

/** Diff between a commit and its first parent (for the graph's compare view). */
export async function commitDiff(
  backend: GitBackend,
  owner: string,
  repo: string,
  oid: string,
): Promise<Array<{ path: string; oldText: string; newText: string; binary: boolean }>> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const commit = (await git.readCommit({ fs, dir, gitdir, oid })).commit;
  const parentOid = commit.parent[0];
  if (!parentOid) return [];
  const [parentMap, commitMap] = await Promise.all([
    readTreeFiles(owner, repo, parentOid),
    readTreeFiles(owner, repo, commit.tree),
  ]);
  const changed = new Set<string>();
  for (const [path, e] of commitMap) {
    const p = parentMap.get(path);
    if (!p || p.oid !== e.oid || p.mode !== e.mode) changed.add(path);
  }
  for (const [path] of parentMap) {
    if (!commitMap.has(path)) changed.add(path);
  }
  const needed = new Set<string>();
  for (const path of changed) {
    for (const map of [parentMap, commitMap]) {
      const e = map.get(path);
      if (e) needed.add(e.oid);
    }
  }
  await ensureBlobs(backend, owner, repo, needed);

  const out: Array<{ path: string; oldText: string; newText: string; binary: boolean }> = [];
  for (const path of changed) {
    const read = async (map: Map<string, { oid: string; mode: string }>) => {
      const e = map.get(path);
      if (!e) return null;
      return (await git.readBlob({ fs, dir, gitdir, oid: e.oid })).blob;
    };
    const oldBytes = await read(parentMap);
    const newBytes = await read(commitMap);
    const binary =
      (oldBytes !== null && isBinaryBytes(oldBytes)) ||
      (newBytes !== null && isBinaryBytes(newBytes));
    out.push({
      path,
      oldText: oldBytes === null ? "" : binary ? `[binary — ${oldBytes.length} bytes]` : decodeText(oldBytes),
      newText: newBytes === null ? "" : binary ? `[binary — ${newBytes.length} bytes]` : decodeText(newBytes),
      binary,
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Check out a commit (detached) or branch, guarding dirty worktrees. */
export async function checkoutRef(
  owner: string,
  repo: string,
  ref: string,
  force: boolean,
): Promise<{ detached: boolean; branch: string | null }> {
  const { fs, dir, gitdir } = await repoCtx(owner, repo);
  const status = await getStatus(owner, repo);
  if (status.length > 0 && !force) {
    throw new Error(
      `Working tree is dirty (${status.length} change${status.length > 1 ? "s" : ""}) — commit or stash before switching.`,
    );
  }
  await git.checkout({ fs, dir, gitdir, ref, force });
  const branch = (await git.currentBranch({ fs, dir, gitdir, fullname: false })) || null;
  return { detached: branch === null, branch };
}
