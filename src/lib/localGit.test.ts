/**
 * End-to-end test of Aria's in-browser git engine (src/lib/localGit.ts).
 *
 * Bun has no IndexedDB, so LightningFS's IndexedDB backend can't run there
 * out of the box. The shim below implements the (tiny) subset of the
 * IndexedDB API LightningFS needs, giving every instance its own private
 * store — so each test is isolated and the engine runs the exact same
 * IndexedDB-backed path the real app uses.
 *
 * The test builds a real remote repository (on a second in-memory LightningFS),
 * serves it through the same GitBackend contract the UI wires to Convex, and
 * then drives the app's own functions: clone → edit → status → stage →
 * commit → merge with a conflict → resolve → finish → push, plus abort, stash
 * and cherry-pick. No mocks of the git engine itself are used — the test
 * backend's pushCommits rebuilds each pushed commit on the remote with real
 * git objects (exact parents, author/committer and dates), mirroring what the
 * Convex action does against the GitHub API, so the SHA-exact push
 * reconstruction is verified end-to-end.
 */
import { describe, expect, test } from "bun:test";
import * as git from "isomorphic-git";
import LightningFS from "@isomorphic-git/lightning-fs";
import {
  abortSession,
  allResolved,
  cherryPickCommit,
  clearActiveSession,
  cloneRepo,
  commitLocal,
  decodeText,
  encodeText,
  finishMerge,
  getActiveSession,
  getGraph,
  getStatus,
  localBranchTip,
  localRepoExists,
  mergeBranch,
  planPush,
  promisesOf,
  pushLocal,
  repoCtx,
  resetEngine,
  resolveConflictFile,
  stageFile,
  stashList,
  stashPop,
  stashPush,
  unstageFile,
  writeWorkFile,
  type GitBackend,
  type GitPerson,
} from "./localGit";
import { applyChoices, threeWayMerge } from "./merge3";

// ---------------------------------------------------------------------------
// Minimal functional IndexedDB shim
// ---------------------------------------------------------------------------
//
// LightningFS's IndexedDB backend is used by src/lib/localGit.ts (the app's
// in-browser git engine), but Bun has no IndexedDB. idb-keyval — the library
// LightningFS persists through — only touches open → transaction →
// objectStore.get/put/delete/clear, so a tiny in-process implementation of
// exactly that surface is enough.
//
// Each open() call gets its own private store map (a closure), so every
// LightningFS instance — and therefore every test — is isolated: a stale
// instance's debounced superblock flush writes into its own map, never the
// next test's. This keeps the engine on the same IndexedDB-backed path the
// real app runs.

function installIndexedDbShim(): void {
  const g = globalThis as { indexedDB?: unknown };
  if (g.indexedDB) return;

  const createRequest = <T>(run: (r: { result: T; error: Error | null }) => void) => {
    const req: {
      result: T;
      error: Error | null;
      onsuccess: null | ((ev?: unknown) => void);
      onerror: null | ((ev?: unknown) => void);
    } = { result: undefined as T, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        run(req);
        req.onsuccess?.(req);
      } catch (err) {
        req.error = err instanceof Error ? err : new Error(String(err));
        req.onerror?.(req);
      }
    });
    return req;
  };

  const open = (name: string) => {
    const stores = new Map<string, Map<unknown, unknown>>();
    const req: {
      result: unknown;
      error: Error | null;
      onsuccess: null | (() => void);
      onerror: null | (() => void);
      onupgradeneeded: null | (() => void);
    } = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };

    queueMicrotask(() => {
      const makeObjectStore = (storeName: string) => {
        let map = stores.get(storeName);
        if (!map) {
          map = new Map();
          stores.set(storeName, map);
        }
        return {
          get(key: unknown) {
            return createRequest<unknown>((r) => {
              r.result = map.get(key);
            });
          },
          put(value: unknown, key: unknown) {
            map.set(key, value);
            return createRequest<undefined>((r) => {
              r.result = undefined;
            });
          },
          delete(key: unknown) {
            map.delete(key);
            return createRequest<undefined>((r) => {
              r.result = undefined;
            });
          },
          clear() {
            map.clear();
            return createRequest<undefined>((r) => {
              r.result = undefined;
            });
          },
        };
      };

      const db = {
        close() {},
        createObjectStore(storeName: string) {
          stores.set(storeName, new Map());
        },
        transaction(storeName: string) {
          const store = makeObjectStore(storeName);
          const tx: {
            oncomplete: null | (() => void);
            onabort: null | (() => void);
            onerror: null | (() => void);
            error: Error | null;
            objectStore: () => typeof store;
          } = {
            oncomplete: null,
            onabort: null,
            onerror: null,
            error: null,
            objectStore: () => store,
          };
          // Fire completion a microtask after the request that the callback
          // issued (get/put/...) has settled.
          queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()));
          return tx;
        },
      };
      req.result = db;
      req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  };

  Object.defineProperty(g, "indexedDB", {
    value: { open } as unknown as IDBFactory,
    configurable: true,
  });
}

installIndexedDbShim();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER = "karan";
const REPO = "notes";

const AUTHOR: GitPerson = {
  name: "Karan Kotwal",
  email: "karankotwal31@gmail.com",
  date: null,
};

const BASE_HELLO = [
  "function greet(name: string): string {",
  '  return "Hello, " + name + "!";',
  "}",
  "",
].join("\n");

const MAIN_HELLO = [
  "function greet(name: string): string {",
  '  return "Hi, " + name + "!";',
  "}",
  "",
].join("\n");

const FEATURE_HELLO = [
  "function greet(name: string): string {",
  '  return "Howdy, " + name + "!";',
  "}",
  "",
].join("\n");

const EDITED_HELLO = [
  "function greet(name: string): string {",
  '  return "Namaste, " + name + "!";',
  "}",
  "",
].join("\n");

// Two independent conflict regions in one file, so a merge produces two
// separate hunks that can be resolved differently (ours vs theirs).
const TWO_BASE = [
  "function greet(name: string): string {",
  '  return "Hello, " + name + "!";',
  "}",
  "function farewell(name: string): string {",
  '  return "Goodbye, " + name + "!";',
  "}",
  "",
].join("\n");

const TWO_OURS = [
  "function greet(name: string): string {",
  '  return "Hi, " + name + "!";',
  "}",
  "function farewell(name: string): string {",
  '  return "Later, " + name + "!";',
  "}",
  "",
].join("\n");

const TWO_THEIRS = [
  "function greet(name: string): string {",
  '  return "Howdy, " + name + "!";',
  "}",
  "function farewell(name: string): string {",
  '  return "Ciao, " + name + "!";',
  "}",
  "",
].join("\n");

// ours for the first hunk, theirs for the second.
const TWO_RESOLVED = [
  "function greet(name: string): string {",
  '  return "Hi, " + name + "!";',
  "}",
  "function farewell(name: string): string {",
  '  return "Ciao, " + name + "!";',
  "}",
  "",
].join("\n");

/** In-memory db for LightningFS (mirrors localGit's private MemoryDb). */
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

let remote: { fs: git.FsClient; pfs: ReturnType<typeof promisesOf>; dir: string; gitdir: string };

async function remoteWrite(path: string, content: string): Promise<void> {
  const parts = path.split("/");
  parts.pop();
  let current = remote.dir;
  for (const part of parts) {
    current = `${current}/${part}`;
    try {
      await remote.pfs.mkdir(current);
    } catch {
      // exists
    }
  }
  await remote.pfs.writeFile(`${remote.dir}/${path}`, encodeText(content));
}

async function remoteCommit(message: string, timestamp: number): Promise<string> {
  const person = {
    name: AUTHOR.name,
    email: AUTHOR.email,
    timestamp,
    // Match the environment's own timezone, so the engine's gitPerson
    // reconstruction (which uses the local offset) round-trips exactly and
    // the cloned commit keeps the remote SHA — like the real app.
    timezoneOffset: new Date(timestamp * 1000).getTimezoneOffset(),
  };
  // isomorphic-git commits the index — stage everything first.
  await git.add({ fs: remote.fs, dir: remote.dir, gitdir: remote.gitdir, filepath: "." });
  return git.commit({
    fs: remote.fs,
    dir: remote.dir,
    gitdir: remote.gitdir,
    message,
    author: person,
    committer: person,
  });
}

/** A GitBackend serving the remote repo — the contract the UI wires to Convex. */
async function makeBackend(): Promise<GitBackend> {
  const { fs, dir, gitdir } = remote;
  return {
    async listBranches() {
      const names = await git.listBranches({ fs, dir, gitdir });
      const out: Array<{ name: string; sha: string }> = [];
      for (const name of names) {
        const oid = await git.resolveRef({ fs, dir, gitdir, ref: `refs/heads/${name}` });
        out.push({ name, sha: oid });
      }
      return out;
    },
    async getCommitDetails({ sha }) {
      const commit = (await git.readCommit({ fs, dir, gitdir, oid: sha })).commit;
      // The engine reconstructs authors through gitPerson(date), which parses
      // the ISO string into the same {timestamp, local timezone offset} pair —
      // so feed it a UTC ISO string of the exact commit instant.
      const iso = (ts: number) => new Date(ts * 1000).toISOString();
      return {
        sha,
        treeSha: commit.tree,
        parents: commit.parent,
        message: commit.message,
        author: {
          name: commit.author.name ?? "",
          email: commit.author.email ?? "",
          date: iso(commit.author.timestamp ?? 0),
        },
        committer: {
          name: commit.committer?.name ?? "",
          email: commit.committer?.email ?? "",
          date: iso(commit.committer?.timestamp ?? 0),
        },
      };
    },
    async getTree({ treeSha }) {
      const entries: Array<{ path: string; mode: string; type: string; sha: string | null }> = [];
      const stack: Array<{ oid: string; prefix: string }> = [{ oid: treeSha, prefix: "" }];
      while (stack.length > 0) {
        const { oid, prefix } = stack.pop()!;
        const { tree } = await git.readTree({ fs, dir, gitdir, oid });
        for (const entry of tree) {
          const path = prefix ? `${prefix}/${entry.path}` : entry.path;
          entries.push({ path, mode: entry.mode, type: entry.type, sha: entry.oid });
          if (entry.type === "tree") stack.push({ oid: entry.oid, prefix: path });
        }
      }
      return entries;
    },
    async getBlob({ sha }) {
      const blob = await git.readBlob({ fs, dir, gitdir, oid: sha });
      return { content: Buffer.from(blob.blob).toString("base64"), size: blob.blob.length };
    },
    async getBlobs({ shas }) {
      const blobs: Array<{ sha: string; content: string; size: number }> = [];
      const remaining: string[] = [];
      for (const sha of shas) {
        try {
          const blob = await git.readBlob({ fs, dir, gitdir, oid: sha });
          blobs.push({ sha, content: Buffer.from(blob.blob).toString("base64"), size: blob.blob.length });
        } catch {
          remaining.push(sha);
        }
      }
      return { blobs, remaining };
    },
    async commitChanges() {
      return { sha: null };
    },
    async pushCommits({ branch, moveRef, force, commit }) {
      // Mirror the Convex action's contract against GitHub: the first parent
      // must already exist on the remote, then blobs → tree → commit (with
      // exact parents/authors/dates) → move the branch ref.
      if (commit.parents.length === 0) {
        throw new Error("Can't push a root commit — create the first commit on GitHub first.");
      }
      let baseTree: string;
      try {
        baseTree = (
          await git.readCommit({
            fs: remote.fs,
            dir: remote.dir,
            gitdir: remote.gitdir,
            oid: commit.parents[0],
          })
        ).commit.tree;
      } catch {
        throw new Error(
          `Parent ${commit.parents[0].slice(0, 7)} isn't on GitHub — push its branch first (it may be a local-only base).`,
        );
      }

      const entries = await remoteTreeMap(baseTree);
      const seen = new Set<string>();
      for (const file of commit.files) {
        if (seen.has(file.path)) {
          throw new Error(`A file appears twice in this commit — stage each file once.`);
        }
        seen.add(file.path);
        if (file.action === "delete") {
          entries.delete(file.path);
          continue;
        }
        if (file.gitlink !== undefined) {
          // Submodule pin — write the pinned SHA as a gitlink (mode 160000).
          entries.set(file.path, { mode: "160000", type: "commit", sha: file.gitlink });
          continue;
        }
        if (file.contentBase64 === undefined) {
          throw new Error(`No content provided for ${file.path}.`);
        }
        const bytes = Buffer.from(file.contentBase64, "base64");
        const hashed = await git.hashBlob({ object: bytes });
        await git.writeBlob({
          fs: remote.fs,
          dir: remote.dir,
          gitdir: remote.gitdir,
          blob: bytes,
        });
        entries.set(file.path, { mode: "100644", type: "blob", sha: hashed.oid });
      }
      const tree = await remoteWriteTree(entries);

      const personOf = (name?: string, email?: string, iso?: string | null) => {
        if (!name || !email) return undefined;
        const parsed = iso ? parseGitDateIso(iso) : { timestamp: 0, timezoneOffset: 0 };
        return { name, email, timestamp: parsed.timestamp, timezoneOffset: parsed.timezoneOffset };
      };
      const author = personOf(commit.authorName, commit.authorEmail, commit.authorDate);
      const committer = personOf(commit.committerName, commit.committerEmail, commit.committerDate);
      const oid = await git.writeCommit({
        fs: remote.fs,
        dir: remote.dir,
        gitdir: remote.gitdir,
        commit: {
          message: commit.message,
          tree,
          parent: commit.parents,
          author: author ?? { name: AUTHOR.name, email: AUTHOR.email, timestamp: 0, timezoneOffset: 0 },
          committer: committer ?? { name: AUTHOR.name, email: AUTHOR.email, timestamp: 0, timezoneOffset: 0 },
        },
      });
      if (moveRef) {
        // GitHub's PATCH refs/heads/{branch} updates an existing ref and
        // rejects non-fast-forward moves unless force is set — mirror that.
        const ref = `refs/heads/${branch}`;
        let current: string | null = null;
        try {
          current = await git.resolveRef({
            fs: remote.fs,
            dir: remote.dir,
            gitdir: remote.gitdir,
            ref,
          });
        } catch {
          current = null;
        }
        if (current !== null && current !== oid && !force) {
          const ancestorLog = await git.log({
            fs: remote.fs,
            dir: remote.dir,
            gitdir: remote.gitdir,
            ref: oid,
            depth: 500,
          });
          if (!ancestorLog.some((c) => c.oid === current)) {
            throw new Error(`Update is not a fast forward for ref ${ref}`);
          }
        }
        await git.writeRef({
          fs: remote.fs,
          dir: remote.dir,
          gitdir: remote.gitdir,
          ref,
          value: oid,
          force: true,
        });
      }
      return { sha: oid };
    },
    async beginBlobUpload() {
      return { uploadId: "test-upload" };
    },
    async uploadBlobChunk() {},
  };
}

async function setupRemote(): Promise<void> {
  const fs = new LightningFS("remote", {
    db: new MemoryDb() as unknown as never,
  }) as unknown as git.FsClient;
  const pfs = promisesOf(fs);
  const dir = "/remote/repo";
  await pfs.mkdir("/remote");
  await pfs.mkdir(dir);
  const gitdir = `${dir}/.git`;
  await git.init({ fs, dir, defaultBranch: "main" });
  await git.setConfig({ fs, dir, path: "user.name", value: AUTHOR.name });
  await git.setConfig({ fs, dir, path: "user.email", value: AUTHOR.email });
  remote = { fs, pfs, dir, gitdir };
  await remoteWrite("README.md", "# Notes\nA calm place for code notes.\n");
  await remoteWrite("hello.ts", BASE_HELLO);
  await remoteWrite("greet.ts", TWO_BASE);
  await remoteCommit("chore: add README, hello.ts and greet.ts", 1_700_000_000);
}

/** Fresh local engine + a fresh clone of the remote. Returns the backend. */
async function freshClone(): Promise<GitBackend> {
  resetEngine();
  clearActiveSession();
  await setupRemote();
  const backend = await makeBackend();
  const result = await cloneRepo(backend, {
    owner: OWNER,
    repo: REPO,
    branch: "main",
    depth: 20,
    author: AUTHOR,
  });
  expect(result.commits).toBeGreaterThanOrEqual(1);
  expect(result.files).toBeGreaterThanOrEqual(2);
  return backend;
}

async function localRead(path: string): Promise<string> {
  const { pfs, dir } = await repoCtx(OWNER, REPO);
  return decodeText((await pfs.readFile(`${dir}/${path}`)) as Uint8Array);
}

async function localCommit(message: string): Promise<{ oid: string; message: string }> {
  return commitLocal({ owner: OWNER, repo: REPO, message, author: AUTHOR });
}

async function makeBranch(name: string, from: string): Promise<void> {
  const { fs, dir, gitdir } = await repoCtx(OWNER, REPO);
  const oid = await git.resolveRef({ fs, dir, gitdir, ref: `refs/heads/${from}` });
  await git.branch({ fs, dir, gitdir, ref: name, object: oid, checkout: false });
}

async function remoteMainTip(): Promise<string> {
  return git.resolveRef({
    fs: remote.fs,
    dir: remote.dir,
    gitdir: remote.gitdir,
    ref: "refs/heads/main",
  });
}

/** Mirror the app's createBranch action: a new branch on GitHub at `fromOid`. */
async function remoteCreateBranch(name: string, fromOid: string): Promise<void> {
  await git.writeRef({
    fs: remote.fs,
    dir: remote.dir,
    gitdir: remote.gitdir,
    ref: `refs/heads/${name}`,
    value: fromOid,
    force: false,
  });
}

/**
 * Parse the engine's gitDateIso() output ("2023-11-14T06:30:00+05:30", UTC
 * instant + git-convention offset) back into the {timestamp, timezoneOffset}
 * pair isomorphic-git's writeCommit expects (JS convention: minutes behind
 * UTC). This is what the Convex action feeds to GitHub's git/commits API to
 * recreate a commit byte-identically.
 */
function parseGitDateIso(iso: string): { timestamp: number; timezoneOffset: number } {
  const offsetMatch = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  const timestamp = Math.floor(new Date(iso).getTime() / 1000);
  let timezoneOffset = 0;
  if (offsetMatch) {
    const ahead = Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]);
    timezoneOffset = offsetMatch[1] === "+" ? -ahead : ahead;
    // isomorphic-git preserves -0 and formats it as "-0000"; the original
    // commit wrote "+0000" for a zero offset. Normalize so the raw line
    // (and therefore the SHA) round-trips exactly.
    if (Object.is(timezoneOffset, -0)) timezoneOffset = 0;
  }
  return { timestamp, timezoneOffset };
}

/** Recursively read a remote tree into path → {mode, type, sha}. */
async function remoteTreeMap(
  treeOid: string,
): Promise<Map<string, { mode: string; type: string; sha: string }>> {
  const map = new Map<string, { mode: string; type: string; sha: string }>();
  const stack: Array<{ oid: string; prefix: string }> = [{ oid: treeOid, prefix: "" }];
  while (stack.length > 0) {
    const { oid, prefix } = stack.pop()!;
    const { tree } = await git.readTree({
      fs: remote.fs,
      dir: remote.dir,
      gitdir: remote.gitdir,
      oid,
    });
    for (const entry of tree) {
      const path = prefix ? `${prefix}/${entry.path}` : entry.path;
      if (entry.type === "tree") {
        stack.push({ oid: entry.oid, prefix: path });
      } else {
        map.set(path, { mode: entry.mode, type: entry.type, sha: entry.oid });
      }
    }
  }
  return map;
}

/** Write a git tree on the remote from a path map (same sort as the engine). */
async function remoteWriteTree(
  entries: Map<string, { mode: string; type: string; sha: string }>,
): Promise<string> {
  const dirMap = new Map<string, Map<string, { mode: string; type: string; sha: string }>>();
  for (const [path, entry] of entries) {
    const parts = path.split("/");
    const name = parts.pop()!;
    const parent = parts.join("/");
    if (!dirMap.has(parent)) dirMap.set(parent, new Map());
    dirMap.get(parent)!.set(name, entry);
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
        type: child.type === "tree" ? ("tree" as const) : (child.type as "blob" | "commit"),
        oid: child.type === "tree" ? oidCache.get(dir ? `${dir}/${name}` : name) ?? child.sha : child.sha,
      }));
    const oid = await git.writeTree({
      fs: remote.fs,
      dir: remote.dir,
      gitdir: remote.gitdir,
      tree,
    });
    oidCache.set(dir, oid);
  }
  const root = oidCache.get("");
  if (!root) throw new Error("Empty tree — nothing to write.");
  return root;
}

// ---------------------------------------------------------------------------
// 1. Clone
// ---------------------------------------------------------------------------

describe("clone", () => {
  test("materializes a browsable repo with clean status and matching tip", async () => {
    await freshClone();
    expect(await localRepoExists(OWNER, REPO)).toBe(true);
    expect(await localBranchTip(OWNER, REPO, "main")).toBe(await remoteMainTip());
    expect(await getStatus(OWNER, REPO)).toEqual([]);
    expect(await localRead("README.md")).toBe("# Notes\nA calm place for code notes.\n");
    expect(await localRead("hello.ts")).toBe(BASE_HELLO);
  });
});

// ---------------------------------------------------------------------------
// 2. Edit → status → stage → unstage → commit → graph
// ---------------------------------------------------------------------------

describe("status / stage / commit", () => {
  test("edit → status → stage → unstage → stage → commit → clean → graph", async () => {
    await freshClone();

    await writeWorkFile(OWNER, REPO, "hello.ts", encodeText(EDITED_HELLO));
    expect(await getStatus(OWNER, REPO)).toEqual([
      { path: "hello.ts", label: "modified", staged: false },
    ]);

    await stageFile(OWNER, REPO, "hello.ts");
    expect(await getStatus(OWNER, REPO)).toEqual([
      { path: "hello.ts", label: "modified", staged: true },
    ]);

    await unstageFile(OWNER, REPO, "hello.ts");
    expect(await getStatus(OWNER, REPO)).toEqual([
      { path: "hello.ts", label: "modified", staged: false },
    ]);

    await stageFile(OWNER, REPO, "hello.ts");
    const { oid } = await localCommit("feat: greet in Hindi");
    expect(await getStatus(OWNER, REPO)).toEqual([]);

    const graph = await getGraph(OWNER, REPO);
    expect(graph.headBranch).toBe("main");
    expect(graph.headOid).toBe(oid);
    const commit = graph.commits.find((c) => c.oid === oid);
    expect(commit?.message.trim()).toBe("feat: greet in Hindi");
    expect(commit?.parents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Merge with a conflict → resolve → finish
// ---------------------------------------------------------------------------

describe("merge with conflicts", () => {
  test("detects the conflict with base/ours/theirs, resolves keep-ours, finishes", async () => {
    await freshClone();

    // feature branch edits the greeting line…
    await makeBranch("feature", "main");
    await git.checkout({ ...(await repoCtx(OWNER, REPO)), ref: "feature" });
    await writeWorkFile(OWNER, REPO, "hello.ts", encodeText(FEATURE_HELLO));
    await stageFile(OWNER, REPO, "hello.ts");
    await localCommit("feat(feature): howdy greeting");

    // …and main edits the same line differently.
    await git.checkout({ ...(await repoCtx(OWNER, REPO)), ref: "main" });
    await writeWorkFile(OWNER, REPO, "hello.ts", encodeText(MAIN_HELLO));
    await stageFile(OWNER, REPO, "hello.ts");
    await localCommit("feat(main): hi greeting");

    const outcome = await mergeBranch(await makeBackend(), {
      owner: OWNER,
      repo: REPO,
      theirs: "feature",
      message: "Merge feature",
      author: AUTHOR,
    });
    expect(outcome.type).toBe("conflicts");
    if (outcome.type !== "conflicts") throw new Error("expected conflicts");

    const file = outcome.files.find((f) => f.path === "hello.ts");
    expect(file).toBeDefined();
    expect(file!.binary).toBe(false);
    expect(file!.gitlink).toBe(false);
    expect(decodeText(file!.base!)).toBe(BASE_HELLO);
    expect(decodeText(file!.ours!)).toBe(MAIN_HELLO);
    expect(decodeText(file!.theirs!)).toBe(FEATURE_HELLO);
    expect(file!.resolved).toBe(false);
    expect(getActiveSession()?.kind).toBe("merge");

    // Keep ours, then finish the merge.
    await resolveConflictFile(OWNER, REPO, "hello.ts", file!.ours);
    expect(allResolved()).toBe(true);
    const mergeOid = await finishMerge({
      owner: OWNER,
      repo: REPO,
      message: "Merge feature",
      author: AUTHOR,
    });
    expect(getActiveSession()).toBeNull();

    // Working tree = ours; merge commit has both parents on the graph.
    expect(await localRead("hello.ts")).toBe(MAIN_HELLO);
    const graph = await getGraph(OWNER, REPO);
    const merge = graph.commits.find((c) => c.oid === mergeOid);
    expect(merge?.message.trim()).toBe("Merge feature");
    expect(merge?.parents).toHaveLength(2);
    expect(graph.branches.find((b) => b.name === "main")?.oid).toBe(mergeOid);
    expect(graph.branches.find((b) => b.name === "feature")).toBeDefined();
  });

  test("abortSession rolls the merge back to the pre-merge working tree", async () => {
    await freshClone();

    await makeBranch("feature", "main");
    await git.checkout({ ...(await repoCtx(OWNER, REPO)), ref: "feature" });
    await writeWorkFile(OWNER, REPO, "hello.ts", encodeText(FEATURE_HELLO));
    await stageFile(OWNER, REPO, "hello.ts");
    await localCommit("feat(feature): howdy greeting");

    await git.checkout({ ...(await repoCtx(OWNER, REPO)), ref: "main" });
    await writeWorkFile(OWNER, REPO, "hello.ts", encodeText(MAIN_HELLO));
    await stageFile(OWNER, REPO, "hello.ts");
    await localCommit("feat(main): hi greeting");

    const outcome = await mergeBranch(await makeBackend(), {
      owner: OWNER,
      repo: REPO,
      theirs: "feature",
      message: "Merge feature",
      author: AUTHOR,
    });
    expect(outcome.type).toBe("conflicts");
    if (outcome.type !== "conflicts") throw new Error("expected conflicts");

    // Resolve one file, then abort anyway — the merge must vanish entirely.
    const file = outcome.files[0];
    await resolveConflictFile(OWNER, REPO, file.path, file.ours);
    expect(allResolved()).toBe(true);
    await abortSession({ owner: OWNER, repo: REPO });

    expect(getActiveSession()).toBeNull();
    expect(await getStatus(OWNER, REPO)).toEqual([]);
    expect(await localRead("hello.ts")).toBe(MAIN_HELLO);
    const graph = await getGraph(OWNER, REPO);
    expect(graph.headBranch).toBe("main");
    expect(graph.commits.find((c) => c.message === "Merge feature")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Stash
// ---------------------------------------------------------------------------

describe("stash", () => {
  test("push → list → pop round-trips a dirty change", async () => {
    await freshClone();
    await writeWorkFile(OWNER, REPO, "hello.ts", encodeText(EDITED_HELLO));

    await stashPush(OWNER, REPO, "wip: try a greeting change");
    expect(await getStatus(OWNER, REPO)).toEqual([]);

    const list = await stashList(OWNER, REPO);
    expect(list.length).toBe(1);
    expect(list[0].label).toContain("wip: try a greeting change");

    await stashPop(OWNER, REPO, 0);
    expect(await getStatus(OWNER, REPO)).toEqual([
      { path: "hello.ts", label: "modified", staged: false },
    ]);
    expect(await localRead("hello.ts")).toBe(EDITED_HELLO);
  });
});

// ---------------------------------------------------------------------------
// 5. Cherry-pick
// ---------------------------------------------------------------------------

describe("cherry-pick", () => {
  test("replays a commit from another branch onto the current branch", async () => {
    await freshClone();

    await makeBranch("feature", "main");
    await git.checkout({ ...(await repoCtx(OWNER, REPO)), ref: "feature" });
    await writeWorkFile(OWNER, REPO, "feature.txt", encodeText("feature-only\n"));
    await stageFile(OWNER, REPO, "feature.txt");
    await localCommit("feat: add feature-only file");
    const featureTip = (await localBranchTip(OWNER, REPO, "feature"))!;

    await git.checkout({ ...(await repoCtx(OWNER, REPO)), ref: "main" });
    await expect(localRead("feature.txt")).rejects.toThrow();

    const outcome = await cherryPickCommit(await makeBackend(), {
      owner: OWNER,
      repo: REPO,
      oid: featureTip,
    });
    expect(outcome.conflict).toBe(false);
    if (outcome.conflict) throw new Error("expected clean cherry-pick");

    expect(outcome.oid).toBeTruthy();
    expect(await localRead("feature.txt")).toBe("feature-only\n");
    const graph = await getGraph(OWNER, REPO);
    expect(graph.commits.some((c) => c.oid === outcome.oid)).toBe(true);
    expect(graph.headBranch).toBe("main");
  });
});

// ---------------------------------------------------------------------------
// 6. Push (SHA-exact reconstruction on a real remote)
// ---------------------------------------------------------------------------

describe("push (SHA-exact reconstruction)", () => {
  test("clone → two-branch conflict → per-hunk resolve → merge → push → remote matches local", async () => {
    const backend = await freshClone();

    // feature edits both regions of greet.ts differently…
    await makeBranch("feature", "main");
    // Create the branch on GitHub too (the app's createBranch action), so
    // pushing feature is a fast-forward, like in the real workspace.
    await remoteCreateBranch("feature", await remoteMainTip());
    await git.checkout({ ...(await repoCtx(OWNER, REPO)), ref: "feature" });
    await writeWorkFile(OWNER, REPO, "greet.ts", encodeText(TWO_THEIRS));
    await stageFile(OWNER, REPO, "greet.ts");
    await localCommit("feat(feature): howdy + ciao greetings");
    const featureTip = (await localBranchTip(OWNER, REPO, "feature"))!;

    // …and main edits the same two regions differently.
    await git.checkout({ ...(await repoCtx(OWNER, REPO)), ref: "main" });
    await writeWorkFile(OWNER, REPO, "greet.ts", encodeText(TWO_OURS));
    await stageFile(OWNER, REPO, "greet.ts");
    await localCommit("feat(main): hi + later greetings");
    const mainTip = (await localBranchTip(OWNER, REPO, "main"))!;

    // Push feature first so the merge commit's second parent exists remotely.
    await git.checkout({ ...(await repoCtx(OWNER, REPO)), ref: "feature" });
    const featurePush = await pushLocal(backend, {
      owner: OWNER,
      repo: REPO,
      branch: "feature",
    });
    expect(featurePush.pushed).toBe(1);
    expect(featurePush.finalSha).toBe(featureTip);
    expect(featurePush.ancestryReplayed).toBe(false);
    expect(
      await git.resolveRef({
        fs: remote.fs,
        dir: remote.dir,
        gitdir: remote.gitdir,
        ref: "refs/heads/feature",
      }),
    ).toBe(featureTip);

    await git.checkout({ ...(await repoCtx(OWNER, REPO)), ref: "main" });

    // Merging feature into main conflicts on both regions of greet.ts.
    const outcome = await mergeBranch(backend, {
      owner: OWNER,
      repo: REPO,
      theirs: "feature",
      message: "Merge feature",
      author: AUTHOR,
    });
    expect(outcome.type).toBe("conflicts");
    if (outcome.type !== "conflicts") throw new Error("expected conflicts");
    const file = outcome.files.find((f) => f.path === "greet.ts");
    expect(file).toBeDefined();
    expect(file!.binary).toBe(false);

    // Resolve exactly like the resolver UI: split into three-way chunks and
    // pick ours for hunk 1, theirs for hunk 2.
    const full = threeWayMerge(
      decodeText(file!.base!),
      decodeText(file!.ours!),
      decodeText(file!.theirs!),
    );
    const conflictChunks = full.chunks.filter((c) => c.kind === "conflict");
    expect(conflictChunks.length).toBe(2);
    let conflictIndex = 0;
    const resolved = applyChoices(full.chunks, (chunk) => {
      if (chunk.kind === "common") return "base";
      const pick = conflictIndex === 0 ? "ours" : "theirs";
      conflictIndex++;
      return pick;
    });
    expect(resolved).toBe(TWO_RESOLVED);

    await resolveConflictFile(OWNER, REPO, "greet.ts", encodeText(resolved));
    expect(allResolved()).toBe(true);
    const mergeOid = await finishMerge({
      owner: OWNER,
      repo: REPO,
      message: "Merge feature",
      author: AUTHOR,
    });
    expect(await localRead("greet.ts")).toBe(TWO_RESOLVED);

    // Push main. featureTip is reachable through the merge's second parent,
    // so the engine recreates it too — but it already exists on GitHub (we
    // pushed it earlier), so it content-addresses to the SAME sha instead of
    // creating a duplicate.
    const mainPush = await pushLocal(backend, {
      owner: OWNER,
      repo: REPO,
      branch: "main",
    });
    expect(mainPush.pushed).toBe(3);
    expect(mainPush.finalSha).toBe(mergeOid);
    expect(mainPush.ancestryReplayed).toBe(false);

    // The remote now matches local exactly: same tip SHA, both parents of the
    // merge preserved, the resolved content landed on GitHub, and the feature
    // branch ref wasn't disturbed.
    expect(await remoteMainTip()).toBe(mergeOid);
    expect(await localBranchTip(OWNER, REPO, "main")).toBe(mergeOid);
    expect(
      await git.resolveRef({
        fs: remote.fs,
        dir: remote.dir,
        gitdir: remote.gitdir,
        ref: "refs/heads/feature",
      }),
    ).toBe(featureTip);
    const remoteMerge = (
      await git.readCommit({
        fs: remote.fs,
        dir: remote.dir,
        gitdir: remote.gitdir,
        oid: mergeOid,
      })
    ).commit;
    expect(remoteMerge.parent).toEqual([mainTip, featureTip]);
    const remoteGreet = decodeText(
      (
        await git.readBlob({
          fs: remote.fs,
          dir: remote.dir,
          gitdir: remote.gitdir,
          oid: (await remoteTreeMap(remoteMerge.tree)).get("greet.ts")!.sha,
        })
      ).blob,
    );
    expect(remoteGreet).toBe(TWO_RESOLVED);
  });
});

// ---------------------------------------------------------------------------
// 7. Push guards (diverged remote)
// ---------------------------------------------------------------------------

describe("push guards", () => {
  test("a diverged remote requires an explicit force push — never silent", async () => {
    const backend = await freshClone();

    // Another device pushed to main while we were offline.
    await remoteWrite("other.txt", "from another device\n");
    await remoteCommit("chore: remote-only change", 1_700_100_000);

    // Local commit on top of the old base.
    await writeWorkFile(OWNER, REPO, "hello.ts", encodeText(EDITED_HELLO));
    await stageFile(OWNER, REPO, "hello.ts");
    await localCommit("feat: local greeting change");
    const localTip = (await localBranchTip(OWNER, REPO, "main"))!;

    const plan = await planPush(backend, { owner: OWNER, repo: REPO, branch: "main" });
    expect(plan.needsForce).toBe(true);
    expect(plan.localTip).toBe(localTip);

    // Without consent the push refuses to rewrite history…
    await expect(
      pushLocal(backend, { owner: OWNER, repo: REPO, branch: "main" }),
    ).rejects.toThrow(/diverged|rewrite history/);

    // …and with an explicit force the remote tip lands on the local commit.
    const forced = await pushLocal(backend, {
      owner: OWNER,
      repo: REPO,
      branch: "main",
      force: true,
    });
    expect(forced.pushed).toBe(1);
    expect(forced.replayed).toBe(true);
    expect(forced.finalSha).toBe(localTip);
    expect(await remoteMainTip()).toBe(localTip);
  });
});
