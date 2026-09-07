"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { billingConfigured } from "./billingConfig";
import { summarizeChecks } from "../lib/checks";
import { threeWayMerge } from "../lib/merge3";
import { createHash } from "crypto";
import type { Id } from "./_generated/dataModel";
import { anySecretRisk } from "../lib/secrets";
import {
  cleanMultiline,
  cleanName,
  cleanPath,
  cleanSearchQuery,
} from "../lib/sanitize";
import { fetchWithRetry } from "./net";
import { GITHUB_ACTIONS_PER_MINUTE } from "./security";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "aria";

interface GitHubRepo {
  full_name: string;
  name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  updated_at: string | null;
}

interface GitHubContentItem {
  name: string;
  path: string;
  type: string;
  size: number;
}

interface GitHubFile {
  type: string;
  encoding: string;
  content: string;
  size: number;
  sha: string;
  truncated: boolean;
}

interface GitHubBranch {
  name: string;
  commit: { sha: string };
}

interface GitHubRef {
  object: { sha: string };
}

interface GitHubCommitItem {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string | null; date: string | null } | null;
  };
  parents?: Array<{ sha: string }>;
  tree?: { sha: string };
}

interface GitHubTreeEntry {
  path: string;
  type: string;
  mode?: string;
  sha?: string | null;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  html_url: string;
  user?: { login: string } | null;
  created_at?: string | null;
  draft?: boolean;
  head?: { ref: string; sha?: string } | null;
  base?: { ref: string } | null;
  mergeable?: boolean | null;
  mergeable_state?: string;
}

interface GitHubMergeResponse {
  merged?: boolean;
  message?: string;
  sha?: string | null;
}

interface GitHubCheckRun {
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  details_url?: string | null;
  app?: { name?: string | null } | null;
}

interface GitHubCommitStatus {
  state?: string | null;
  context?: string | null;
  description?: string | null;
  target_url?: string | null;
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  user?: { login: string } | null;
  created_at?: string | null;
  comments?: number;
  pull_request?: unknown;
  body?: string | null;
  labels?: Array<{ name: string }>;
}

export interface CommitResult {
  sha: string | null;
  blobSha?: string;
  message: string;
  htmlUrl: string | null;
}

export interface BranchResult {
  name: string;
  sha: string;
}

export interface PullRequestResult {
  number: number;
  title: string;
  htmlUrl: string;
}

function githubHeaders(token: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
    ...extra,
  };
}

// GitHub contents API paths must have each segment URI-encoded.
function encodePath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Clean a commit message from user input; throws when it's empty. */
function cleanCommitMessage(raw: string): string {
  const message = cleanMultiline(raw, 2000);
  if (!message) throw new Error("A commit message is required.");
  return message;
}

/** Clean + validate a repo-relative path from user input; throws when bad. */
function cleanFilePath(raw: string): string {
  const path = cleanPath(raw);
  if (!path) throw new Error("That path isn't valid.");
  return path;
}

function validateRepoPart(value: string, label: "owner" | "repository"): string {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/.test(value)) {
    throw new Error(`That GitHub ${label} name isn't valid.`);
  }
  return value;
}

async function githubFetch<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  // Automatic retry (Part D): transient network errors, 429s and 5xx are
  // retried with backoff before we give up; 4xx errors pass through.
  const res = await fetchWithRetry(url, {
    ...init,
    headers: githubHeaders(
      token,
      init?.headers as Record<string, string> | undefined,
    ),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      (data as { message?: string } | null)?.message ??
      `GitHub request failed (${res.status} ${res.statusText})`;
    throw new Error(message);
  }
  return data as T;
}

/**
 * Resolve the signed-in user's GitHub access token, or throw if absent.
 * Also enforces the per-user GitHub action rate limit (Part D): called once
 * per action, it bounds how many GitHub operations a user can fire per
 * minute. Combined with GitHub's own hourly quota and the retry helper.
 */
async function getToken(ctx: ActionCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("You are not signed in.");
  }
  const allowed = await ctx.runMutation(internal.security.bumpRateLimit, {
    bucket: `github:${userId}`,
    limit: GITHUB_ACTIONS_PER_MINUTE,
  });
  if (!allowed) {
    throw new Error(
      "You're making GitHub requests too quickly — wait a minute and try again.",
    );
  }
  const connection = await ctx.runQuery(internal.github.connectionForUser, {
    userId,
  });
  if (connection === null) {
    throw new Error("GitHub is not connected.");
  }
  return connection.token;
}

/**
 * Free-tier repo gate — enforced at the action layer, never by UI hiding.
 * Public repos are free; on the Free plan at most one private repo may be
 * opened. Paid plans (and dev mode with no Stripe keys) are unrestricted.
 * Every repo opened through the workspace is recorded in `connectedRepos`.
 */
async function ensureRepoAccess(
  ctx: ActionCtx,
  owner: string,
  repo: string,
  token: string,
): Promise<void> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("You are not signed in.");
  validateRepoPart(owner, "owner");
  validateRepoPart(repo, "repository");
  const full = `${owner}/${repo}`;
  const meta = await githubFetch<{ private: boolean }>(`${GITHUB_API}/repos/${owner}/${repo}`, token);
  await ctx.runMutation(internal.github.admitRepo, {
    repo: full, isPrivate: meta.private, enforceLimit: billingConfigured(),
  });
}

/** Parse GitHub's `Link` header for the next page URL, if any. */
function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const next = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  return next?.[1] ?? null;
}

/**
 * Fetch the user's repositories across pages (up to a cap). A single
 * per_page=100 page silently truncates accounts with more than 100 repos, so
 * the list follows GitHub's Link header for up to 5 pages (500 repos). Later
 * pages are best-effort: a transient failure mid-way returns the repos
 * already fetched instead of losing the whole list — partial data beats a
 * hard failure for large accounts.
 */
export const listRepositories = action({
  args: {},
  handler: async (ctx) => {
    const token = await getToken(ctx);
    // owner + collaborator + organization_member covers personal repos and
    // every repo the user can access through organizations they belong to.
    const MAX_PAGES = 5;
    const all = new Map<string, GitHubRepo>();
    let url: string | null =
      `${GITHUB_API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`;
    for (let page = 0; page < MAX_PAGES && url !== null; page++) {
      let res: Response;
      try {
        res = await fetchWithRetry(url, { headers: githubHeaders(token) });
      } catch {
        break; // network hiccup — keep what we already have
      }
      if (!res.ok) break; // 4xx/5xx after retries — stop paginating
      let items: GitHubRepo[] = [];
      try {
        const text = await res.text();
        const data: unknown = text ? JSON.parse(text) : [];
        if (Array.isArray(data)) items = data as GitHubRepo[];
      } catch {
        break;
      }
      for (const repo of items) all.set(repo.full_name, repo);
      url = nextPageUrl(res.headers.get("link"));
    }
    return [...all.values()].map((repo) => ({
      fullName: repo.full_name,
      name: repo.name,
      private: !!repo.private,
      description: repo.description ?? null,
      defaultBranch: repo.default_branch,
      updatedAt: repo.updated_at ?? null,
    }));
  },
});

export const listContents = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    path: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    // Free-tier gate: opening a repo is the choke point for repo access.
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const path = args.path ? cleanFilePath(args.path) : "";
    const url = `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(
      path,
    )}?ref=${encodeURIComponent(args.branch)}`;
    const data = await githubFetch<GitHubContentItem[] | GitHubContentItem>(
      url,
      token,
    );
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type === "dir" ? "dir" : "file",
      size: item.size ?? 0,
    }));
  },
});

export const getFile = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    path: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const path = cleanFilePath(args.path);
    const url = `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(
      path,
    )}?ref=${encodeURIComponent(args.branch)}`;
    const data = await githubFetch<GitHubFile>(url, token);
    if (data.type !== "file") {
      throw new Error("That path is not a file.");
    }
    if (data.encoding !== "base64" || typeof data.content !== "string") {
      throw new Error("This file isn't text and can't be edited in the browser.");
    }
    if (data.size > 1_000_000) {
      throw new Error("This file is over 1 MB and too large to edit here.");
    }
    const content = Buffer.from(data.content, "base64").toString("utf8");
    return {
      content,
      sha: data.sha,
      size: data.size,
      truncated: data.truncated === true,
    };
  },
});

export const commitFile = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    path: v.string(),
    branch: v.string(),
    message: v.string(),
    content: v.string(),
    sha: v.optional(v.string()),
    allowSecrets: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const path = cleanFilePath(args.path);
    const risk = anySecretRisk([{ path, content: args.content }]);
    if (risk.risky && !args.allowSecrets) {
      throw new Error(
        `Aria refuses to commit ${risk.files.join(", ")} — it looks like it contains secrets. Confirm “commit anyway” to override.`,
      );
    }
    return commitBatch(ctx, { ...args, files: [{ path, action: "update", content: args.content, expectedSha: args.sha }] });
  },
});

/** Create a brand-new file at `path` (no sha — GitHub creates it). */
export const createFile = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    path: v.string(),
    branch: v.string(),
    message: v.string(),
    content: v.string(),
    allowSecrets: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const path = cleanFilePath(args.path);
    const risk = anySecretRisk([{ path, content: args.content }]);
    if (risk.risky && !args.allowSecrets) {
      throw new Error(
        `Aria refuses to create ${risk.files.join(", ")} — it looks like it contains secrets. Confirm “commit anyway” to override.`,
      );
    }
    return commitBatch(ctx, { ...args, files: [{ path, action: "create", content: args.content, expectedSha: null }] });
  },
});

/** Delete an existing file (requires its blob sha). */
export const deleteFile = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    path: v.string(),
    branch: v.string(),
    message: v.string(),
    sha: v.string(),
  },
  handler: async (ctx, args) => {
    const path = cleanFilePath(args.path);
    return commitBatch(ctx, { ...args, files: [{ path, action: "delete", expectedSha: args.sha }] });
  },
});

/**
 * Rename a file: copy it to the new path and delete the old path, wrapped in
 * a single action. The GitHub contents API has no one-call rename, so this
 * makes two requests back to back.
 */
export const renameFile = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    oldPath: v.string(),
    newPath: v.string(),
    branch: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const oldPath = cleanFilePath(args.oldPath);
    const newPath = cleanFilePath(args.newPath);
    if (oldPath === newPath) {
      throw new Error("New path is the same as the current path.");
    }
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const oldData = await githubFetch<GitHubFile>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(
        oldPath,
      )}?ref=${encodeURIComponent(args.branch)}`,
      token,
    );
    if (oldData.type !== "file" || oldData.encoding !== "base64" || typeof oldData.content !== "string") {
      throw new Error("This file cannot be renamed through the contents API.");
    }
    const result = await commitBatch(ctx, { ...args, files: [
      { path: oldPath, action: "delete", expectedSha: oldData.sha },
      { path: newPath, action: "create", expectedSha: null, contentBase64: oldData.content },
    ], preserveModeFrom: oldPath });
    return { ...result, content: Buffer.from(oldData.content, "base64").toString("utf8") };
  },
});

/**
 * List every file (path + size) in a branch via the recursive Git tree.
 * Powers instant ⌘K file search without walking the contents API.
 */
export const listTreeFiles = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;
    const ref = await githubFetch<GitHubRef>(
      `${repoUrl}/git/ref/heads/${encodeURIComponent(args.branch)}`,
      token,
    );
    const commit = await githubFetch<{ tree?: { sha?: string } }>(
      `${repoUrl}/git/commits/${encodeURIComponent(ref.object.sha)}`,
      token,
    );
    if (!commit.tree?.sha) throw new Error("GitHub did not return the branch tree. Retry the operation.");
    const tree = await githubFetch<{
      tree: Array<{ path: string; type: string; size?: number }>;
    }>(`${repoUrl}/git/trees/${encodeURIComponent(commit.tree.sha)}?recursive=1`, token);
    return tree.tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => ({ path: entry.path, size: entry.size ?? 0 }))
      .sort((a, b) => a.path.localeCompare(b.path));
  },
});

/**
 * List the recent commit history of a branch (newest first).
 */
export const getCommitHistory = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
    perPage: v.optional(v.number()),
    page: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const perPage = Math.min(Math.max(args.perPage ?? 50, 1), 100);
    const page = Math.max(args.page ?? 1, 1);
    const data = await githubFetch<GitHubCommitItem[]>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/commits?sha=${encodeURIComponent(
        args.branch,
      )}&per_page=${perPage}&page=${page}`,
      token,
    );
    return data.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author?.name ?? "unknown",
      date: c.commit.author?.date ?? null,
      htmlUrl: c.html_url,
    }));
  },
});

/**
 * Full details for one commit: parents, tree, author/committer, and the files
 * it changed. Powers the in-browser git engine (clone, graph, rebase,
 * cherry-pick).
 */
export const getCommitDetails = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    sha: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const data = await githubFetch<{
      sha: string;
      tree?: { sha: string };
      parents?: Array<{ sha: string }>;
      commit: {
        tree?: { sha: string };
        message: string;
        author: {
          name: string | null;
          email: string | null;
          date: string | null;
        } | null;
        committer: {
          name: string | null;
          email: string | null;
          date: string | null;
        } | null;
      };
      files?: Array<{
        filename: string;
        status: string;
        patch: string | null;
      }>;
    }>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/commits/${encodeURIComponent(
        args.sha,
      )}`,
      token,
    );
    return {
      sha: data.sha,
      treeSha: data.commit.tree?.sha ?? null,
      parents: (data.parents ?? []).map((p) => p.sha),
      message: data.commit.message,
      author: {
        name: data.commit.author?.name ?? "Aria",
        email:
          data.commit.author?.email ?? "aria@users.noreply.github.com",
        date: data.commit.author?.date ?? null,
      },
      committer: {
        name: data.commit.committer?.name ?? "Aria",
        email:
          data.commit.committer?.email ?? "aria@users.noreply.github.com",
        date: data.commit.committer?.date ?? null,
      },
      files: (data.files ?? []).map((f) => ({
        filename: f.filename,
        status: f.status,
        patch: f.patch ?? null,
      })),
    };
  },
});

/**
 * Full recursive tree listing for one tree sha (paths + blob shas + modes).
 * Falls back to a non-recursive walk when GitHub truncates the listing on
 * very large repos.
 */
export const getTree = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    treeSha: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;

    const fetchNested = async (
      treeSha: string,
    ): Promise<
      Array<{ path: string; mode: string; type: string; sha: string | null }>
    > => {
      const data = await githubFetch<{
        tree: GitHubTreeEntry[];
        truncated?: boolean;
      }>(
        `${repoUrl}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
        token,
      );
      if (!data.truncated) {
        return data.tree.map((e) => ({
          path: e.path,
          mode: e.mode ?? "100644",
          type: e.type,
          sha: e.sha ?? null,
        }));
      }
      // Truncated: walk the tree one directory at a time.
      const out: Array<{
        path: string;
        mode: string;
        type: string;
        sha: string | null;
      }> = [];
      const queue: Array<{ treeSha: string; prefix: string }> = [
        { treeSha, prefix: "" },
      ];
      while (queue.length > 0) {
        const next = queue.shift()!;
        const t = await githubFetch<{ tree: GitHubTreeEntry[] }>(
          `${repoUrl}/git/trees/${encodeURIComponent(next.treeSha)}`,
          token,
        );
        for (const entry of t.tree) {
          const path = next.prefix
            ? `${next.prefix}/${entry.path}`
            : entry.path;
          out.push({
            path,
            mode: entry.mode ?? "100644",
            type: entry.type,
            sha: entry.sha ?? null,
          });
          if (entry.type === "tree" && entry.sha) {
            queue.push({ treeSha: entry.sha, prefix: path });
          }
        }
      }
      return out;
    };

    // Submodule entries (type "commit", gitlinks) pass through — the engine
    // writes them as mode-160000 tree entries and skips materializing their
    // contents, so repos with submodules clone and operate correctly.
    return fetchNested(args.treeSha);
  },
});

/**
 * Raw blob content for one blob sha, returned base64-encoded so binary files
 * round-trip losslessly into the in-browser git engine.
 */
export const getBlob = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    sha: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const data = await githubFetch<{ content: string; size: number }>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/git/blobs/${encodeURIComponent(
        args.sha,
      )}`,
      token,
    );
    if (data.size > 700_000) {
      throw new Error(
        `${args.sha.slice(0, 7)} is ${Math.round(data.size / 1024)} KB — too large for the in-browser engine (limit 700 KB per file).`,
      );
    }
    return { content: data.content, size: data.size };
  },
});

/**
 * Bulk blob download for cloning: fetches as many blobs as fit in one Convex
 * response (~800 KB) and returns the rest so the engine can loop. Cuts clone
 * round-trips from one call per file to one call per ~25 small files.
 */
export const getBlobs = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    shas: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;
    const blobs: Array<{ sha: string; content: string; size: number }> = [];
    let total = 0;
    for (const sha of args.shas) {
      const data = await githubFetch<{ content: string; size: number }>(
        `${repoUrl}/git/blobs/${encodeURIComponent(sha)}`,
        token,
      );
      if (data.size > 700_000) {
        throw new Error(
          `${sha.slice(0, 7)} is ${Math.round(data.size / 1024)} KB — too large for the in-browser engine (limit 700 KB per file).`,
        );
      }
      if (total + data.size > 800_000 && blobs.length > 0) break;
      blobs.push({ sha, content: data.content, size: data.size });
      total += data.size;
    }
    return { blobs, remaining: args.shas.slice(blobs.length) };
  },
});

/**
 * Revert a commit by creating a new commit that applies its exact reverse,
 * built with the Git Data API (tree entries → commit → fast-forward ref).
 * The original commit stays in history untouched.
 */
export const revertCommit = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
    commitSha: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;

    const target = await githubFetch<GitHubCommitItem>(`${repoUrl}/commits/${args.commitSha}`, token);
    if (target.parents?.length !== 1) throw new Error("Root and merge commits require an explicit revert strategy.");
    const ref = await githubFetch<GitHubRef>(`${repoUrl}/git/ref/heads/${encodeURIComponent(args.branch)}`, token);
    const [before, after, current] = await Promise.all([
      fetchCommitTree(repoUrl, target.parents[0].sha, token),
      fetchCommitTree(repoUrl, args.commitSha, token),
      fetchCommitTree(repoUrl, ref.object.sha, token),
    ]);
    const map = (rows: GitHubTreeEntry[]) => new Map(rows.filter(e => e.type !== "tree").map(e => [e.path, e]));
    const old = map(before), changed = map(after), head = map(current);
    const same = (a?: GitHubTreeEntry, b?: GitHubTreeEntry) => a?.sha === b?.sha && a?.mode === b?.mode;
    const files: PushFile[] = [];
    const read = async (entry: GitHubTreeEntry) => {
      const blob = await githubFetch<{ content: string; size: number }>(`${repoUrl}/git/blobs/${entry.sha}`, token);
      if (blob.size > 700_000) throw new Error(`Revert ${entry.path} locally: file exceeds the online merge limit.`);
      return Buffer.from(blob.content, "base64");
    };
    for (const path of new Set([...old.keys(), ...changed.keys()])) {
      const prior = old.get(path), targetEntry = changed.get(path), now = head.get(path);
      if (same(prior, targetEntry) || same(prior, now)) continue;
      if (same(now, targetEntry)) {
        if (!prior) files.push({ path, action: "delete", expectedSha: now!.sha });
        else if (prior.type === "commit") files.push({ path, action: now ? "update" : "create", expectedSha: now?.sha ?? null, gitlink: prior.sha! });
        else files.push({ path, action: now ? "update" : "create", expectedSha: now?.sha ?? null,
          mode: prior.mode as PushFile["mode"], contentBase64: (await read(prior)).toString("base64") });
      } else {
        if (!prior || !targetEntry || !now || [prior, targetEntry, now].some(e => e.type !== "blob"))
          throw new Error(`Revert conflict in ${path}. Later changes must be reconciled first.`);
        const [base, ours, theirs] = await Promise.all([read(targetEntry), read(now), read(prior)]);
        if ([base, ours, theirs].some(b => b.includes(0) || !Buffer.from(b.toString("utf8")).equals(b)))
          throw new Error(`Binary revert conflict in ${path}. Resolve it locally.`);
        const result = threeWayMerge(base.toString("utf8"), ours.toString("utf8"), theirs.toString("utf8"));
        if (!result.clean) throw new Error(`Revert conflict in ${path}. Later edits were preserved; resolve the conflict first.`);
        const mode = prior.mode === targetEntry.mode ? now.mode : now.mode === targetEntry.mode ? prior.mode : null;
        if (!mode) throw new Error(`Revert mode conflict in ${path}.`);
        files.push({ path, action: "update", expectedSha: now.sha, mode: mode as PushFile["mode"], content: result.result.join("\n") });
      }
    }
    if (!files.length) throw new Error("This change is already reverted or has no remaining file changes.");
    return commitBatch(ctx, { ...args, message: `Revert "${target.commit.message.split("\n")[0]}"\n\nThis reverts commit ${args.commitSha}.`, files });
  },
});

/**
 * Commit several file changes to a branch in one atomic commit using the
 * Git Data API (blobs → tree → commit → update ref). This is what powers
 * multi-file staging: a batch of staged files lands as a single commit.
 */
const pushFileValidator = v.object({
  path: v.string(),
  expectedSha: v.optional(v.union(v.string(), v.null())),
  mode: v.optional(v.union(v.literal("100644"), v.literal("100755"), v.literal("120000"))),
  action: v.union(
    v.literal("update"),
    v.literal("create"),
    v.literal("delete"),
  ),
  // Exactly one content source for non-delete files:
  content: v.optional(v.string()), // utf-8 text (small files)
  contentBase64: v.optional(v.string()), // raw bytes (binary files)
  uploadId: v.optional(v.id("blobUploads")), // chunked upload (large files)
  // Submodule pin — tree entry mode 160000, no blob content.
  gitlink: v.optional(v.string()),
});
type PushFile = {
  path: string;
  expectedSha?: string | null;
  mode?: "100644" | "100755" | "120000";
  action: "update" | "create" | "delete";
  content?: string;
  contentBase64?: string;
  uploadId?: Id<"blobUploads">;
  gitlink?: string;
};

/** Resolve a file to its base64 payload (null for deletes). */
async function filePayloadBase64(
  ctx: ActionCtx,
  file: PushFile,
): Promise<string | null> {
  if (file.action === "delete" || file.gitlink !== undefined) return null;
  if (file.content !== undefined) {
    return Buffer.from(file.content, "utf8").toString("base64");
  }
  if (file.contentBase64 !== undefined) return file.contentBase64;
  if (file.uploadId !== undefined) {
    const upload = await ctx.runQuery(internal.github.getBlobUploadChunks, {
      uploadId: file.uploadId,
    });
    if (upload === null) {
      throw new Error("A chunked upload expired or was cleaned up — retry the push.");
    }
    const joined = upload.data.join("");
    const decoded = Buffer.from(joined, "base64");
    if (decoded.length !== upload.size) {
      throw new Error("A chunked upload was incomplete — retry the push.");
    }
    const sha = createHash("sha1")
      .update(`blob ${upload.size}\0`)
      .update(decoded)
      .digest("hex");
    if (sha !== upload.sha) {
      throw new Error("A chunked upload failed its integrity check — retry the push.");
    }
    return joined;
  }
  throw new Error(`No content provided for ${file.path}.`);
}

interface GitCommitPerson {
  name: string;
  email: string;
  date: string | null;
}

/**
 * Create a commit on GitHub: blobs → tree (base_tree + changes) → commit with
 * explicit parents and authorship. Shared by the workspace commit flow and
 * the in-browser engine's push (which needs exact parents + force support).
 */
async function createGitHubCommit(
  ctx: ActionCtx,
  args: {
    token: string;
    owner: string;
    repo: string;
    branch?: string; // used by the approval-policy gate
    message: string;
    parents: string[];
    baseTreeSha: string;
    files: PushFile[];
    allowSecrets?: boolean;
    author?: GitCommitPerson;
    committer?: GitCommitPerson;
  },
): Promise<{ sha: string; message: string; htmlUrl: string | null }> {
  if (!args.message.trim()) throw new Error("A commit message is required.");
  if (args.files.length === 0) throw new Error("Nothing to commit.");
  const message = cleanCommitMessage(args.message);
  // Keep the normalized message on the shared args object so all callers
  // (including local pushes) use the same bounded value.
  args.message = message;
  const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;

  if (!args.branch) throw new Error("A target branch is required.");
  const payloads = new Map<string, string | null>();
  for (const file of args.files) {
    if (cleanFilePath(file.path) !== file.path) throw new Error("Invalid file path.");
    payloads.set(file.path, await filePayloadBase64(ctx, file));
  }
  const textFiles = args.files.filter(f => f.action !== "delete");
  const risk = anySecretRisk(textFiles.map(f => ({ path: f.path,
    content: Buffer.from(payloads.get(f.path) ?? "", "base64").toString("utf8"),
  })));
  if (risk.risky && !args.allowSecrets) {
    throw new Error(
      `Aria refuses to commit ${risk.files.join(", ")} — ${risk.files.length > 1 ? "they look" : "it looks"} like ${risk.files.length > 1 ? "they contain" : "it contains"} secrets. Confirm “commit anyway” to override.`,
    );
  }
  if (new Set(args.files.map((f) => f.path)).size !== args.files.length) {
    throw new Error("A file appears twice in this commit — stage each file once.");
  }

  // Project constitution (Phase 3): "block" rules refuse the commit
  // server-side; "require_review" rules are recorded in the audit trail.
  const commitUserId = await getAuthUserId(ctx);
  const gate = (await ctx.runQuery(internal.securityCenter.ruleGateForFiles, {
    repo: `${args.owner}/${args.repo}`,
    files: args.files.map((f) => f.path),
    userId: commitUserId ?? undefined,
  })) as { blocked: Array<{ file: string; title: string; body: string }>; review: Array<{ file: string; title: string; body: string }> };
  if (gate.blocked.length > 0) {
    const first = gate.blocked[0];
    throw new Error(
      `Aria refuses to commit ${first.file} — your project constitution rule “${first.title}” blocks it: ${first.body}`,
    );
  }
  if (gate.review.length > 0) {
    await ctx
      .runMutation(internal.securityCenter.audit, {
        userId: (await getAuthUserId(ctx)) ?? undefined,
        action: "commit.rule_review",
        repo: `${args.owner}/${args.repo}`,
        result: "review",
        detail: `Requires-review rules matched: ${gate.review
          .map((r) => `${r.title} (${r.file})`)
          .join(", ")}`,
      })
      .catch(() => {});
  }
  // Secret override: record that an override happened WITHOUT recording the
  // secret itself (Phase 3 flight/audit requirement).
  if (risk.risky && args.allowSecrets) {
    await ctx
      .runMutation(internal.securityCenter.audit, {
        userId: (await getAuthUserId(ctx)) ?? undefined,
        action: "commit.secret_override",
        repo: `${args.owner}/${args.repo}`,
        result: "overridden",
        detail: `Secret guard overridden for: ${risk.files.join(", ")}`, // paths only
      })
      .catch(() => {});
  }

  try {
    // Create a blob for every changed file. Deletes and submodule pins need
    // no blob — gitlinks (mode 160000) carry a commit SHA directly.
    const blobShas = new Map<string, string>();
    const gitlinkShas = new Map<string, string>();
    for (const file of args.files) {
      if (file.gitlink !== undefined) {
        gitlinkShas.set(file.path, file.gitlink);
        continue;
      }
      const payload = payloads.get(file.path);
      if (payload === null) continue;
      const blob = await githubFetch<{ sha: string }>(
        `${repoUrl}/git/blobs`,
        args.token,
        {
          method: "POST",
          body: JSON.stringify({ content: payload, encoding: "base64" }),
          headers: { "Content-Type": "application/json" },
        },
      );
      blobShas.set(file.path, blob.sha);
    }

    // Rebuild the tree from the base commit: keep untouched blobs and
    // submodule pins (type "commit", mode 160000), swap in the new ones, and
    // null out deleted paths (sha: null deletes).
    const baseTree = await githubFetch<{
      sha: string;
      tree: Array<{
        path: string;
        type: string;
        mode?: string;
        sha?: string | null;
      }>;
    }>(`${repoUrl}/git/trees/${encodeURIComponent(args.baseTreeSha)}?recursive=1`, args.token);

    baseTree.tree = await fetchCompleteTree(repoUrl, args.baseTreeSha, args.token);
    const deleted = new Set(
      args.files.filter((f) => f.action === "delete").map((f) => f.path),
    );
    const changed = new Set([
      ...blobShas.keys(),
      ...gitlinkShas.keys(),
      ...deleted,
    ]);
    const tree: Array<{
      path: string;
      mode: string;
      type: "blob" | "commit";
      sha: string | null;
    }> = baseTree.tree
      .filter((entry) => entry.type !== "tree" && !changed.has(entry.path))
      .map((entry) => ({
        path: entry.path,
        mode: entry.type === "commit" ? "160000" : entry.mode ?? "100644",
        type: entry.type === "commit" ? ("commit" as const) : ("blob" as const),
        sha: entry.sha ?? "",
      }));
    for (const file of args.files) {
      if (file.gitlink !== undefined) {
        // Write the pinned submodule SHA directly as a gitlink entry.
        tree.push({
          path: file.path,
          mode: "160000",
          type: "commit" as const,
          sha: file.gitlink,
        });
        continue;
      }
      const sha = blobShas.get(file.path);
      if (sha) {
        const original = baseTree.tree.find(e => e.path === file.path);
        tree.push({ path: file.path, mode: file.mode ?? original?.mode ?? "100644", type: "blob" as const, sha });
      }
    }
    for (const path of deleted) {
      // Match the deleted entry's kind so removing a submodule pin is written
      // as a gitlink delete, not a blob delete.
      const base = baseTree.tree.find((e) => e.path === path);
      const gitlink = base?.type === "commit";
      tree.push({
        path,
        mode: gitlink ? "160000" : "100644",
        type: gitlink ? ("commit" as const) : ("blob" as const),
        sha: null,
      });
    }

    const newTree = await githubFetch<{ sha: string }>(
      `${repoUrl}/git/trees`,
      args.token,
      {
        method: "POST",
        body: JSON.stringify({ base_tree: baseTree.sha, tree }),
        headers: { "Content-Type": "application/json" },
      },
    );

    const body: Record<string, unknown> = {
      message: args.message,
      tree: newTree.sha,
      parents: args.parents,
    };
    if (args.author) {
      body.author = {
        name: args.author.name,
        email: args.author.email,
        ...(args.author.date ? { date: args.author.date } : {}),
      };
    }
    if (args.committer) {
      body.committer = {
        name: args.committer.name,
        email: args.committer.email,
        ...(args.committer.date ? { date: args.committer.date } : {}),
      };
    }
    const commit = await githubFetch<{
      sha: string;
      message: string;
      html_url: string | null;
    }>(`${repoUrl}/git/commits`, args.token, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

  // Approval policies (Phase 4 C): when the actor belongs to an org whose
  // protected-branch policy matches this commit, the action is blocked
  // server-side until the policy is satisfied (role + approval count).
  if (commitUserId !== null) {
    const policyGate = await ctx
      .runMutation(internal.organizations.internalCommitGate, {
        userId: commitUserId,
        repo: `${args.owner}/${args.repo}`,
        branch: args.branch,
        proposedCommit: commit.sha,
        changeKey: createHash("sha256").update(JSON.stringify({ base: args.baseTreeSha,
          parents: args.parents, author: args.author, committer: args.committer, message: args.message, files: args.files.map(f => ({ path: f.path,
            action: f.action, mode: f.mode, gitlink: f.gitlink, payload: payloads.get(f.path) })).sort((a,b) => a.path.localeCompare(b.path)) })).digest("hex"),
        paths: args.files.map((f) => f.path),
      });
    if (policyGate && !policyGate.satisfied) {
      throw new Error(
        `Aria refuses this commit: your organization “${policyGate.orgName}” requires the ${policyGate.minRole} role (or higher) and ${policyGate.minApprovers} approval(s) for changes to ${args.branch || "this branch"} (${policyGate.approvalCount} recorded so far). Approve it in the Release center, or work on a non-protected branch.`,
      );
    }
    if (policyGate && policyGate.satisfied) {
      await ctx
        .runMutation(internal.securityCenter.audit, {
          userId: commitUserId,
          action: "commit.approval_gate",
          repo: `${args.owner}/${args.repo}`,
          branch: args.branch,
          result: "approved",
          approval: true,
          detail: `Protected-branch policy satisfied (${policyGate.minRole}+, ${policyGate.approvalCount}/${policyGate.minApprovers} approvals)`,
        })
        .catch(() => {});
    }
  }
    return {
      sha: commit.sha,
      message: commit.message ?? args.message,
      htmlUrl: commit.html_url ?? null,
    };
  } finally {
    // Uploads remain available for a retry if the ref lease changes. New
    // uploads prune abandoned rows, and successful batch commits remove theirs.
  }
}

async function commitBatch(ctx: ActionCtx, args: {
  owner: string; repo: string; branch: string; message: string; allowSecrets?: boolean;
  files: PushFile[]; preserveModeFrom?: string;
}): Promise<CommitResult> {
  const token = await getToken(ctx);
  await ensureRepoAccess(ctx, args.owner, args.repo, token);
  const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;
  const ref = await githubFetch<GitHubRef>(`${repoUrl}/git/ref/heads/${encodeURIComponent(args.branch)}`, token);
  const headSha = ref.object.sha;
  const headCommit = await githubFetch<{ tree?: { sha?: string } }>(
    `${repoUrl}/git/commits/${encodeURIComponent(headSha)}`,
    token,
  );
  const baseTreeSha = headCommit.tree?.sha;
  if (!baseTreeSha) throw new Error("GitHub did not return the branch tree. Retry the operation.");
  const tree = await fetchCompleteTree(repoUrl, baseTreeSha, token);
  for (const f of args.files) {
    const current = tree.find(e => e.path === f.path);
    if (f.action === "create") {
      if (current) throw new Error(`Conflict: ${f.path} already exists. Reload before committing.`);
    } else if (!f.expectedSha || current?.sha !== f.expectedSha) {
      throw new Error(`Conflict: ${f.path} changed since it was opened. Reload and merge your edits before committing.`);
    }
  }
  const files = args.files.map(f => ({ ...f, mode: f.mode ?? (args.preserveModeFrom
    ? tree.find(e => e.path === args.preserveModeFrom)?.mode as PushFile["mode"] : undefined) }));
  const created = await createGitHubCommit(ctx, { token, ...args, files, parents: [headSha], baseTreeSha });
  // A branch can move while blobs and the commit are being created. Refuse
  // to overwrite that newer tip instead of relying on a potentially stale
  // read from the beginning of the action.
  const latestRef = await githubFetch<GitHubRef>(
    `${repoUrl}/git/ref/heads/${encodeURIComponent(args.branch)}`,
    token,
  );
  if (latestRef.object.sha !== headSha) {
    throw new Error("Conflict: the branch changed while this commit was being prepared. Reload and retry.");
  }
  await githubFetch<GitHubRef>(`${repoUrl}/git/refs/heads/${encodeURIComponent(args.branch)}`, token, {
    method: "PATCH", body: JSON.stringify({ sha: created.sha, force: false }), headers: { "Content-Type": "application/json" },
  });
  const writes = files.filter(f => f.action !== "delete");
  const lastWrite = writes.length > 0 ? writes[writes.length - 1] : undefined;
  const file = lastWrite ? await githubFetch<GitHubFile>(`${repoUrl}/contents/${encodePath(lastWrite.path)}?ref=${created.sha}`, token) : null;
  await cleanupBlobUploads(ctx, files);
  return { ...created, ...(file ? { blobSha: file.sha } : {}) };
}

async function fetchCommitTree(repoUrl: string, commitSha: string, token: string): Promise<GitHubTreeEntry[]> {
  const commit = await githubFetch<{ tree?: { sha?: string } }>(
    `${repoUrl}/git/commits/${encodeURIComponent(commitSha)}`,
    token,
  );
  if (!commit.tree?.sha) throw new Error(`GitHub did not return the tree for commit ${commitSha.slice(0, 7)}.`);
  return fetchCompleteTree(repoUrl, commit.tree.sha, token);
}

async function fetchCompleteTree(repoUrl: string, treeSha: string, token: string): Promise<GitHubTreeEntry[]> {
  const recursive = await githubFetch<{ tree: GitHubTreeEntry[]; truncated?: boolean }>(`${repoUrl}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`, token);
  if (!recursive.truncated) return recursive.tree;
  const out: GitHubTreeEntry[] = [];
  const queue = [{ sha: treeSha, prefix: "" }];
  while (queue.length) {
    const next = queue.shift()!;
    const t = await githubFetch<{ tree: GitHubTreeEntry[] }>(`${repoUrl}/git/trees/${next.sha}`, token);
    for (const e of t.tree) {
      const path = next.prefix + e.path;
      if (e.type === "tree" && e.sha) queue.push({ sha: e.sha, prefix: path + "/" });
      else out.push({ ...e, path });
    }
  }
  return out;
}

async function cleanupBlobUploads(ctx: ActionCtx, files: PushFile[]) {
  for (const uploadId of new Set(files.flatMap((file) => file.uploadId ? [file.uploadId] : []))) {
    await ctx.runMutation(internal.github.deleteBlobUpload, { uploadId }).catch(() => {});
  }
}

export const commitChanges = action({
  args: { owner: v.string(), repo: v.string(), branch: v.string(), message: v.string(),
    allowSecrets: v.optional(v.boolean()), files: v.array(pushFileValidator) },
  handler: commitBatch,
});

/**
 * Create one commit on GitHub with explicit parents and optional authorship,
 * then (optionally) move the branch ref — with `force` for rewrites. The
 * in-browser engine uses this to push local chains with exact ancestry.
 */
export const pushCommits = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
    moveRef: v.boolean(),
    force: v.boolean(),
    expectedHead: v.optional(v.string()),
    allowSecrets: v.optional(v.boolean()),
    commit: v.object({
      message: v.string(),
      parents: v.array(v.string()),
      authorName: v.optional(v.string()),
      authorEmail: v.optional(v.string()),
      // Nullable for parity with the in-browser engine's commit interface;
      // null is normalized away before the GitHub API call.
      authorDate: v.optional(v.union(v.string(), v.null())),
      committerName: v.optional(v.string()),
      committerEmail: v.optional(v.string()),
      committerDate: v.optional(v.union(v.string(), v.null())),
      files: v.array(pushFileValidator),
    }),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;
    const commit = args.commit;
    if (commit.parents.length === 0) {
      throw new Error("Can't push a root commit — create the first commit on GitHub first.");
    }

    const branchRef = await githubFetch<GitHubRef>(
      `${repoUrl}/git/ref/heads/${encodeURIComponent(args.branch)}`,
      token,
    );
    const leaseHead = branchRef.object.sha;
    if (args.expectedHead && args.expectedHead !== leaseHead) {
      throw new Error("Conflict: the remote branch changed before this push started. Fetch and retry.");
    }
    if (args.moveRef && !args.force && commit.parents[0] !== leaseHead) {
      throw new Error("Conflict: this push is not a fast-forward of the remote branch. Fetch and merge first.");
    }
    if (args.moveRef && args.force && !args.expectedHead) {
      throw new Error("A force push requires the remote tip as an explicit lease.");
    }

    // The first parent must exist on GitHub already; its tree is the base
    // the new commit's tree is built on.
    const parentCommit = await githubFetch<{ tree?: { sha: string } }>(
      `${repoUrl}/git/commits/${encodeURIComponent(commit.parents[0])}`,
      token,
    );
    const baseTreeSha = parentCommit.tree?.sha;
    if (!baseTreeSha) {
      throw new Error(
        `Parent ${commit.parents[0].slice(0, 7)} isn't on GitHub — push its branch first (it may be a local-only base).`,
      );
    }

    const created = await createGitHubCommit(ctx, {
      token,
      owner: args.owner,
      repo: args.repo,
      branch: args.branch,
      allowSecrets: args.allowSecrets,
      message: commit.message,
      parents: commit.parents,
      baseTreeSha,
      files: commit.files,
      author:
        commit.authorName && commit.authorEmail
          ? {
              name: commit.authorName,
              email: commit.authorEmail,
              date: commit.authorDate ?? null,
            }
          : undefined,
      committer:
        commit.committerName && commit.committerEmail
          ? {
              name: commit.committerName,
              email: commit.committerEmail,
              date: commit.committerDate ?? null,
            }
          : undefined,
    });

    if (args.moveRef) {
      // Re-check the lease immediately before moving the ref. GitHub's REST
      // endpoint does not expose a native force-with-lease parameter, so this
      // check is the safest available guard against a stale rewrite.
      const latestRef = await githubFetch<GitHubRef>(
        `${repoUrl}/git/ref/heads/${encodeURIComponent(args.branch)}`,
        token,
      );
      if (latestRef.object.sha !== leaseHead) {
        throw new Error("Conflict: the remote branch changed while this push was being prepared. Nothing was overwritten.");
      }
      await githubFetch<GitHubRef>(
        `${repoUrl}/git/refs/heads/${encodeURIComponent(args.branch)}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: created.sha, force: args.force }),
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    await cleanupBlobUploads(ctx, commit.files);

    return {
      sha: created.sha,
      message: created.message,
      htmlUrl: created.htmlUrl,
    } as CommitResult;
  },
});

export const listBranches = action({
  args: {
    owner: v.string(),
    repo: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const data = await githubFetch<GitHubBranch[]>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/branches?per_page=100`,
      token,
    );
    return data.map((branch) => ({
      name: branch.name,
      sha: branch.commit.sha,
    })) as BranchResult[];
  },
});

/** Create a branch `name` pointing at the current tip of `base`. */
export const createBranch = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    name: v.string(),
    base: v.string(),
  },
  handler: async (ctx, args) => {
    const name = cleanName(args.name, 200).replace(/\s+/g, "-");
    const base = cleanName(args.base, 200);
    if (!name || !base) throw new Error("That branch name isn't valid.");
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const ref = await githubFetch<GitHubRef>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/git/ref/heads/${encodeURIComponent(
        base,
      )}`,
      token,
    );
    await githubFetch<GitHubRef>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/git/refs`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${name}`,
          sha: ref.object.sha,
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    return { name, sha: ref.object.sha } as BranchResult;
  },
});

/** Open a pull request from `head` into `base`. */
export const createPullRequest = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    title: v.string(),
    head: v.string(),
    base: v.string(),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const title = cleanMultiline(args.title, 300);
    const head = cleanName(args.head, 200);
    const base = cleanName(args.base, 200);
    const body = args.body ? cleanMultiline(args.body, 5000) : "";
    if (!title || !head || !base) {
      throw new Error("Title, head, and base branch are required.");
    }
    // Secret guardrail (Phase 3): a PR title/body must not carry live
    // credentials — no override exists for PRs, only for local commits.
    const prRisk = anySecretRisk([
      { path: "PR title", content: title },
      { path: "PR body", content: body },
    ]);
    if (prRisk.risky) {
      throw new Error(
        `Aria refuses to open this PR — ${prRisk.files.join(
          ", ",
        )} looks like it contains a secret. Remove it and try again.`,
      );
    }
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const data = await githubFetch<GitHubPullRequest>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/pulls`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          title,
          head,
          base,
          body,
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    await ctx
      .runMutation(internal.securityCenter.audit, {
        userId: (await getAuthUserId(ctx)) ?? undefined,
        action: "pr.create",
        repo: `${args.owner}/${args.repo}`,
        branch: head,
        result: "ok",
        detail: `PR #${data.number} ${head} → ${base}`,
      })
      .catch(() => {});
    return {
      number: data.number,
      title: data.title,
      htmlUrl: data.html_url,
    } as PullRequestResult;
  },
});

/** List the open pull requests for a repo (most recently updated first). */
export const listPullRequests = action({
  args: {
    owner: v.string(),
    repo: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const data = await githubFetch<GitHubPullRequest[]>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/pulls?state=open&sort=updated&direction=desc&per_page=50`,
      token,
    );
    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      htmlUrl: pr.html_url,
      author: pr.user?.login ?? "unknown",
      createdAt: pr.created_at ?? null,
      draft: pr.draft ?? false,
      head: pr.head?.ref ?? "",
      base: pr.base?.ref ?? "",
      // null = GitHub is still computing mergeability.
      mergeable: pr.mergeable ?? null,
      mergeableState: pr.mergeable_state ?? "",
    }));
  },
});

/**
 * Merge an open pull request. Refuses cleanly when the PR can't merge (has
 * conflicts or is still being checked) instead of letting GitHub return an
 * opaque error.
 */
export const mergePullRequest = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    number: v.number(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const pr = await githubFetch<GitHubPullRequest>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/pulls/${args.number}`,
      token,
    );
    if (pr.mergeable === false) {
      throw new Error(
        "This pull request has conflicts that must be resolved before it can be merged.",
      );
    }
    if (pr.mergeable === null) {
      throw new Error(
        "GitHub is still checking whether this pull request can merge — try again in a few seconds.",
      );
    }
    if (pr.draft) {
      throw new Error("Draft pull requests can't be merged — mark it ready first.");
    }
    if (!pr.head?.sha) {
      throw new Error("GitHub did not return the pull request head SHA. Refresh and try again.");
    }
    const data = await githubFetch<GitHubMergeResponse>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/pulls/${args.number}/merge`,
      token,
      {
        method: "PUT",
        body: JSON.stringify({ merge_method: "squash", sha: pr.head?.sha }),
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!data.merged) {
      throw new Error(data.message ?? "GitHub refused to merge the pull request.");
    }
    return {
      merged: true,
      sha: data.sha ?? null,
      message: data.message ?? `Merged pull request #${args.number}`,
    };
  },
});

/**
 * CI status for a branch: the combined result of GitHub check runs and
 * legacy commit statuses on the branch tip. Powers the "did my commit pass?"
 * chip and the verified-agent gate (don't merge a red build).
 */
export const getBranchChecks = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args): Promise<{
    sha: string;
    overall: "none" | "pending" | "failure" | "success";
    checkRuns: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      detailsUrl: string | null;
    }>;
    statusContexts: Array<{
      context: string;
      state: string;
      description: string | null;
      targetUrl: string | null;
    }>;
  }> => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;

    // Branch tip commit.
    const commit = await githubFetch<GitHubCommitItem>(
      `${repoUrl}/commits/${encodeURIComponent(args.branch)}`,
      token,
    );
    const sha = commit.sha;

    // Check runs (GitHub Actions and other apps).
    let checkRuns: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      detailsUrl: string | null;
    }> = [];
    try {
      const checks = await githubFetch<{ check_runs: GitHubCheckRun[] }>(
        `${repoUrl}/commits/${sha}/check-runs?per_page=50`,
        token,
      );
      checkRuns = (checks.check_runs ?? []).map((c) => ({
        name: c.name ?? c.app?.name ?? "check",
        status: c.status ?? "",
        conclusion: c.conclusion ?? null,
        detailsUrl: c.details_url ?? null,
      }));
    } catch {
      checkRuns.push({ name: "Checks unavailable", status: "unknown", conclusion: null, detailsUrl: null });
    }

    // Legacy commit status contexts.
    let statusContexts: Array<{
      context: string;
      state: string;
      description: string | null;
      targetUrl: string | null;
    }> = [];
    try {
      const status = await githubFetch<{ statuses: GitHubCommitStatus[] }>(
        `${repoUrl}/commits/${sha}/status`,
        token,
      );
      statusContexts = (status.statuses ?? []).map((s) => ({
        context: s.context ?? "",
        state: s.state ?? "",
        description: s.description ?? null,
        targetUrl: s.target_url ?? null,
      }));
    } catch {
      statusContexts.push({ context: "Statuses unavailable", state: "pending", description: null, targetUrl: null });
    }

    const overall = summarizeChecks(checkRuns, statusContexts);

    return { sha, overall, checkRuns, statusContexts };
  },
});

/** Files changed by a pull request, with unified-diff patches for review. */
export const getPullRequestFiles = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    number: v.number(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const data = await githubFetch<
      Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
      }>
    >(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/pulls/${args.number}/files?per_page=100`,
      token,
    );
    return data.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      patch: f.patch ?? null,
    }));
  },
});

/** Full-text code search inside a repo (GitHub code search API). */
export const searchCode = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const q = `${cleanSearchQuery(args.query)} repo:${args.owner}/${args.repo}`;
    const data = await githubFetch<{
      items: Array<{ path: string; name: string; html_url: string }>;
    }>(
      `${GITHUB_API}/search/code?q=${encodeURIComponent(q)}&per_page=20`,
      token,
    );
    return (data.items ?? []).map((i) => ({
      path: i.path,
      name: i.name,
      htmlUrl: i.html_url,
    }));
  },
});

/** Open issues for a repo (pull requests excluded). */
export const listIssues = action({
  args: {
    owner: v.string(),
    repo: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const data = await githubFetch<GitHubIssue[]>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/issues?state=open&sort=updated&direction=desc&per_page=50`,
      token,
    );
    return data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        htmlUrl: issue.html_url,
        author: issue.user?.login ?? "unknown",
        createdAt: issue.created_at ?? null,
        comments: issue.comments ?? 0,
        body: issue.body ?? null,
        labels: (issue.labels ?? []).map((l) => l.name),
      }));
  },
});

interface GitHubInboxIssue {
  number: number;
  title: string;
  html_url: string;
  updated_at: string | null;
  pull_request?: { url?: string } | null;
  repository?: { full_name: string } | null;
  repository_url?: string | null;
  head?: { sha: string } | null;
}

/** "https://api.github.com/repos/owner/name" → "owner/name". */
function repoFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  const match = url.match(/\/repos\/([^/]+\/[^/]+)/);
  return match ? match[1] : url.replace(/^https?:\/\/api\.github\.com\/repos\//, "");
}

/** Create an issue in the current repository. */
export const createIssue = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const title = args.title.trim();
    if (!title) throw new Error("Issue title can't be empty.");
    const data = await githubFetch<{
      number: number;
      title: string;
      html_url: string;
    }>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/issues`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          title: title.slice(0, 200),
          body: (args.body ?? "").slice(0, 8000),
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    return { number: data.number, title: data.title, htmlUrl: data.html_url };
  },
});

/**
 * Unified cross-repo inbox (Pro): PRs awaiting the user's review and issues
 * assigned to them, aggregated across every repo/org they can access — one
 * feed instead of per-repo digging. CI state is attached to review PRs so a
 * failing check is visible before opening anything.
 *
 * Public entry: resolves the signed-in user, then delegates. The internal
 * variant is what the push-notification cron calls with an explicit user.
 */
export const getInbox = action({
  args: {},
  handler: async (ctx): Promise<InboxResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    return ctx.runAction(internal.githubActions.getInboxForUser, { userId });
  },
});

/** The inbox result shape (shared by the public + internal variants). */
interface InboxResult {
  awaitingReview: Array<{
    repo: string;
    number: number;
    title: string;
    htmlUrl: string;
    ci: "success" | "failure" | "pending" | "unknown";
    updatedAt: string | null;
  }>;
  assigned: Array<{
    repo: string;
    number: number;
    title: string;
    htmlUrl: string;
    isPr: boolean;
    updatedAt: string | null;
  }>;
}

/** Internal: the same inbox, for an explicit user (used by push checks). */
export const getInboxForUser = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<InboxResult> => {
    const userId = args.userId;
    // Pro gate — enforced at the action layer, never by UI hiding. Skipped in
    // dev mode (no Stripe keys) so the app stays fully unlocked until then.
    if (billingConfigured()) {
      const billing = await ctx.runQuery(internal.billing.planForUser, {
        userId,
      });
      if (billing.plan === "free") {
        throw new Error(
          "The unified inbox is a Pro feature — upgrade to see activity across all your repositories.",
        );
      }
    }
    // Explicit annotations break the inference cycle that otherwise makes the
    // whole api type degrade to `any` under tsc's noImplicitAny.
    const conn: {
      token: string;
      login: string;
      name: string | null;
      avatar: string | null;
    } | null = await ctx.runQuery(internal.github.connectionForUser, {
      userId,
    });
    if (conn === null) throw new Error("GitHub is not connected.");
    const token: string = conn.token;
    const login: string = conn.login ?? "";

    // 1. Everything assigned to me and open, across all repos.
    const assigned = await githubFetch<GitHubInboxIssue[]>(
      `${GITHUB_API}/user/issues?filter=assigned&state=open&sort=updated&direction=desc&per_page=50`,
      token,
    );

    // 2. PRs waiting on my review.
    const awaiting: { items: GitHubInboxIssue[] } | null =
      login !== ""
        ? await githubFetch<{ items: GitHubInboxIssue[] }>(
            `${GITHUB_API}/search/issues?q=${encodeURIComponent(
              `is:open is:pr review-requested:${login}`,
            )}&sort=updated&order=desc&per_page=30`,
            token,
          )
        : null;

    // 3. CI state for the PRs awaiting review (bounded — one status call each).
    const prs = (awaiting?.items ?? []).slice(0, 8);
    const awaitingReview = await Promise.all(
      prs.map(async (pr): Promise<{
        repo: string;
        number: number;
        title: string;
        htmlUrl: string;
        ci: "success" | "failure" | "pending" | "unknown";
        updatedAt: string | null;
      }> => {
        const repoFull = repoFromUrl(pr.repository_url);
        const [owner, repo] = repoFull.split("/");
        let ci: "success" | "failure" | "pending" | "unknown" = "unknown";
        if (pr.head?.sha && owner && repo) {
          try {
            const status = await githubFetch<{ state: string }>(
              `${GITHUB_API}/repos/${owner}/${repo}/commits/${pr.head.sha}/status`,
              token,
            );
            ci =
              status.state === "success"
                ? "success"
                : status.state === "failure"
                  ? "failure"
                  : "pending";
          } catch {
            // CI unknown — keep "unknown" and move on.
          }
        }
        return {
          repo: repoFull,
          number: pr.number,
          title: pr.title,
          htmlUrl: pr.html_url,
          ci,
          updatedAt: pr.updated_at ?? null,
        };
      }),
    );

    const assignedItems = assigned.slice(0, 30).map((item) => ({
      repo: item.repository?.full_name ?? repoFromUrl(item.repository_url),
      number: item.number,
      title: item.title,
      htmlUrl: item.html_url,
      isPr: !!item.pull_request,
      updatedAt: item.updated_at ?? null,
    }));

    return { awaitingReview, assigned: assignedItems };
  },
});

/**
 * Submit a PR review (used by actionable push notifications). Currently only
 * "approve" is exposed; a comment body can be supplied for the comment path.
 */
export const submitReview = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    number: v.number(),
    event: v.union(v.literal("approve"), v.literal("comment")),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    await ensureRepoAccess(ctx, args.owner, args.repo, token);
    const data = await githubFetch<{ id: number; state: string }>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/pulls/${args.number}/reviews`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          event: args.event.toUpperCase(),
          body:
            args.body ??
            (args.event === "approve"
              ? "Approved from Aria ✅"
              : "Commented from Aria"),
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    return { id: data.id, state: data.state };
  },
});


/** Binding policies requires both organization administration and GitHub repo administration. */
export const linkOrganizationRepository = action({
  args: { orgId: v.id("organizations"), owner: v.string(), repo: v.string() },
  handler: async (ctx, args) => {
    validateRepoPart(args.owner, "owner");
    validateRepoPart(args.repo, "repository");
    const token = await getToken(ctx);
    const meta = await githubFetch<{ permissions?: { admin?: boolean } }>(`${GITHUB_API}/repos/${args.owner}/${args.repo}`, token);
    if (!meta.permissions?.admin) throw new Error("GitHub repository admin permission is required.");
    await ctx.runMutation(internal.organizations.linkRepository, { orgId: args.orgId, repo: `${args.owner}/${args.repo}`, userId: (await getAuthUserId(ctx))! });
  },
});
