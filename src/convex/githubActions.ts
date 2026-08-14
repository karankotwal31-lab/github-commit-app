"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { anySecretRisk } from "../lib/secrets";

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

interface GitHubCommitResponse {
  commit?: {
    sha?: string;
    message?: string;
    html_url?: string;
  };
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

interface CompareFile {
  filename: string;
  previous_filename?: string;
  status: string;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  html_url: string;
  user?: { login: string } | null;
  created_at?: string | null;
  draft?: boolean;
  head?: { ref: string } | null;
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

async function githubFetch<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
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

/** Resolve the signed-in user's GitHub access token, or throw if absent. */
async function getToken(ctx: ActionCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("You are not signed in.");
  }
  const connection = await ctx.runQuery(internal.github.connectionForUser, {
    userId,
  });
  if (connection === null) {
    throw new Error("GitHub is not connected.");
  }
  return connection.token;
}

export const listRepositories = action({
  args: {},
  handler: async (ctx) => {
    const token = await getToken(ctx);
    // owner + collaborator + organization_member covers personal repos and
    // every repo the user can access through organizations they belong to.
    const data = await githubFetch<GitHubRepo[]>(
      `${GITHUB_API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`,
      token,
    );
    return data.map((repo) => ({
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
    const url = `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(
      args.path,
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
    const url = `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(
      args.path,
    )}?ref=${encodeURIComponent(args.branch)}`;
    const data = await githubFetch<GitHubFile>(url, token);
    if (data.type !== "file") {
      throw new Error("That path is not a file.");
    }
    if (data.encoding !== "base64" || !data.content) {
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
    const risk = anySecretRisk([{ path: args.path, content: args.content }]);
    if (risk.risky && !args.allowSecrets) {
      throw new Error(
        `Aria refuses to commit ${risk.files.join(", ")} — it looks like it contains secrets. Confirm “commit anyway” to override.`,
      );
    }
    const token = await getToken(ctx);
    const body: Record<string, unknown> = {
      message: args.message,
      content: Buffer.from(args.content, "utf8").toString("base64"),
      branch: args.branch,
    };
    if (args.sha) body.sha = args.sha;
    const data = await githubFetch<GitHubCommitResponse>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(args.path)}`,
      token,
      {
        method: "PUT",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
    );
    return {
      sha: data.commit?.sha ?? null,
      message: data.commit?.message ?? args.message,
      htmlUrl: data.commit?.html_url ?? null,
    };
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
    const risk = anySecretRisk([{ path: args.path, content: args.content }]);
    if (risk.risky && !args.allowSecrets) {
      throw new Error(
        `Aria refuses to create ${risk.files.join(", ")} — it looks like it contains secrets. Confirm “commit anyway” to override.`,
      );
    }
    const token = await getToken(ctx);
    const data = await githubFetch<GitHubCommitResponse>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(args.path)}`,
      token,
      {
        method: "PUT",
        body: JSON.stringify({
          message: args.message,
          content: Buffer.from(args.content, "utf8").toString("base64"),
          branch: args.branch,
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    return {
      sha: data.commit?.sha ?? null,
      message: data.commit?.message ?? args.message,
      htmlUrl: data.commit?.html_url ?? null,
    } as CommitResult;
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
    const token = await getToken(ctx);
    const data = await githubFetch<GitHubCommitResponse>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(args.path)}`,
      token,
      {
        method: "DELETE",
        body: JSON.stringify({
          message: args.message,
          sha: args.sha,
          branch: args.branch,
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    return {
      sha: data.commit?.sha ?? null,
      message: data.commit?.message ?? args.message,
      htmlUrl: data.commit?.html_url ?? null,
    } as CommitResult;
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
    if (args.oldPath === args.newPath) {
      throw new Error("New path is the same as the current path.");
    }
    const token = await getToken(ctx);
    const oldData = await githubFetch<GitHubFile>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(
        args.oldPath,
      )}?ref=${encodeURIComponent(args.branch)}`,
      token,
    );
    if (oldData.type !== "file" || oldData.encoding !== "base64" || !oldData.content) {
      throw new Error("That path isn't a readable text file — can't rename it.");
    }
    const content = Buffer.from(oldData.content, "base64").toString("utf8");
    const created = await githubFetch<GitHubCommitResponse>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(
        args.newPath,
      )}`,
      token,
      {
        method: "PUT",
        body: JSON.stringify({
          message: args.message,
          content: Buffer.from(content, "utf8").toString("base64"),
          branch: args.branch,
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    try {
      await githubFetch<GitHubCommitResponse>(
        `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(
          args.oldPath,
        )}`,
        token,
        {
          method: "DELETE",
          body: JSON.stringify({
            message: args.message,
            sha: oldData.sha,
            branch: args.branch,
          }),
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch {
      throw new Error(
        "The file was created at the new path, but removing the old one failed — check the repo for duplicates.",
      );
    }
    return {
      sha: created.commit?.sha ?? null,
      message: args.message,
      htmlUrl: created.commit?.html_url ?? null,
      content,
    } as CommitResult & { content: string };
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
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;
    const ref = await githubFetch<GitHubRef>(
      `${repoUrl}/git/ref/heads/${encodeURIComponent(args.branch)}`,
      token,
    );
    const tree = await githubFetch<{
      tree: Array<{ path: string; type: string; size?: number }>;
    }>(`${repoUrl}/git/trees/${ref.object.sha}?recursive=1`, token);
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
  },
  handler: async (ctx, args) => {
    const token = await getToken(ctx);
    const perPage = Math.min(Math.max(args.perPage ?? 50, 1), 100);
    const data = await githubFetch<GitHubCommitItem[]>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/commits?sha=${encodeURIComponent(
        args.branch,
      )}&per_page=${perPage}`,
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
    const data = await githubFetch<{
      sha: string;
      tree?: { sha: string };
      parents?: Array<{ sha: string }>;
      commit: {
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
      treeSha: data.tree?.sha ?? null,
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

    const tree = await fetchNested(args.treeSha);
    // Submodule entries (type "commit") can't be materialized in the browser
    // engine — drop them rather than fail the whole clone.
    return tree.filter(
      (e) => e.type === "blob" || e.type === "tree",
    );
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
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;

    // 1. The commit being reverted, its message, and its parent.
    const commit = await githubFetch<GitHubCommitItem>(
      `${repoUrl}/commits/${args.commitSha}`,
      token,
    );
    const parents = commit.parents ?? [];
    if (parents.length === 0) {
      throw new Error(
        "This is the repository's first commit — it can't be reverted.",
      );
    }
    if (parents.length > 1) {
      throw new Error(
        "Merge commits can't be reverted from Aria — revert each branch's changes separately.",
      );
    }
    const parentSha = parents[0].sha;

    // 2. The current branch tip.
    const ref = await githubFetch<GitHubRef>(
      `${repoUrl}/git/ref/heads/${encodeURIComponent(args.branch)}`,
      token,
    );
    const headSha = ref.object.sha;

    // 3. Which files the target commit touched.
    const compare = await githubFetch<{ files?: CompareFile[] }>(
      `${repoUrl}/compare/${parentSha}...${args.commitSha}`,
      token,
    );
    const files = compare.files ?? [];
    if (files.length === 0) {
      throw new Error(
        "That commit didn't change any files — nothing to revert.",
      );
    }

    // 4. The parent tree holds the original blob sha + mode for every path,
    //    so restoring a file needs no content round-trips.
    const parentTree = await githubFetch<{ tree: GitHubTreeEntry[] }>(
      `${repoUrl}/git/trees/${parentSha}?recursive=1`,
      token,
    );
    const parentBlobByPath = new Map<string, { sha: string; mode: string }>();
    for (const entry of parentTree.tree) {
      if (entry.type === "blob" && entry.sha) {
        parentBlobByPath.set(entry.path, {
          sha: entry.sha,
          mode: entry.mode ?? "100644",
        });
      }
    }

    // 5. The head commit's tree is the base the reversed changes build on.
    const headCommit = await githubFetch<GitHubCommitItem>(
      `${repoUrl}/git/commits/${headSha}`,
      token,
    );
    if (!headCommit.tree?.sha) {
      throw new Error("Couldn't resolve the current branch tree.");
    }

    // 6. Build the reverse patch as tree entries:
    //    - added/copied → delete the file that appeared
    //    - modified/removed → restore the original content
    //    - renamed → restore the old path, delete the new one
    const entries: Array<{
      path: string;
      mode: string;
      type: "blob";
      sha: string | null;
    }> = [];
    const touched = new Set<string>();
    for (const file of files) {
      const status = file.status;
      const newPath = file.filename;
      const oldPath = file.previous_filename ?? file.filename;
      if (status === "added" || status === "copied") {
        if (!touched.has(newPath)) {
          entries.push({ path: newPath, mode: "100644", type: "blob", sha: null });
          touched.add(newPath);
        }
      } else if (status === "changed") {
        throw new Error(
          `${newPath} is a submodule change — Aria can't revert that.`,
        );
      } else {
        // modified / removed / renamed → restore the original path.
        const restorePath = status === "renamed" ? oldPath : newPath;
        const original = parentBlobByPath.get(restorePath);
        if (!original) {
          throw new Error(
            `Couldn't find the original version of ${restorePath} to restore.`,
          );
        }
        if (!touched.has(restorePath)) {
          entries.push({
            path: restorePath,
            mode: original.mode,
            type: "blob",
            sha: original.sha,
          });
          touched.add(restorePath);
        }
        if (status === "renamed" && !touched.has(newPath)) {
          entries.push({ path: newPath, mode: "100644", type: "blob", sha: null });
          touched.add(newPath);
        }
      }
    }

    // 7. New tree on top of the current tip.
    const newTree = await githubFetch<{ sha: string }>(
      `${repoUrl}/git/trees`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: entries }),
        headers: { "Content-Type": "application/json" },
      },
    );

    // 8. The revert commit, then fast-forward the branch ref.
    const message = `Revert "${commit.commit.message.split("\n")[0]}"\n\nThis reverts commit ${args.commitSha}.`;
    const newCommit = await githubFetch<GitHubCommitItem>(
      `${repoUrl}/git/commits`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          message,
          tree: newTree.sha,
          parents: [headSha],
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    await githubFetch<GitHubRef>(
      `${repoUrl}/git/refs/heads/${encodeURIComponent(args.branch)}`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ sha: newCommit.sha, force: false }),
        headers: { "Content-Type": "application/json" },
      },
    );

    return {
      sha: newCommit.sha,
      message,
      htmlUrl: newCommit.html_url,
    } as CommitResult;
  },
});

/**
 * Commit several file changes to a branch in one atomic commit using the
 * Git Data API (blobs → tree → commit → update ref). This is what powers
 * multi-file staging: a batch of staged files lands as a single commit.
 */
export const commitChanges = action({
  args: {
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
    message: v.string(),
    allowSecrets: v.optional(v.boolean()),
    files: v.array(
      v.object({
        path: v.string(),
        content: v.string(),
        action: v.union(
          v.literal("update"),
          v.literal("create"),
          v.literal("delete"),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (!args.message.trim()) {
      throw new Error("A commit message is required.");
    }
    if (args.files.length === 0) {
      throw new Error("Nothing to commit.");
    }
    const textFiles = args.files.filter((f) => f.action !== "delete");
    const risk = anySecretRisk(
      textFiles.map((f) => ({ path: f.path, content: f.content })),
    );
    if (risk.risky && !args.allowSecrets) {
      throw new Error(
        `Aria refuses to commit ${risk.files.join(", ")} — ${risk.files.length > 1 ? "they look" : "it looks"} like ${risk.files.length > 1 ? "they contain" : "it contains"} secrets. Confirm “commit anyway” to override.`,
      );
    }
    if (new Set(args.files.map((f) => f.path)).size !== args.files.length) {
      throw new Error("A file appears twice in this commit — stage each file once.");
    }
    for (const file of textFiles) {
      if (!file.path.trim()) {
        throw new Error("A staged file has an empty path.");
      }
      if (file.content.length > 1_000_000) {
        throw new Error(`${file.path} is over 1 MB — too large to commit.`);
      }
    }
    const token = await getToken(ctx);
    const repoUrl = `${GITHUB_API}/repos/${args.owner}/${args.repo}`;

    // 1. Resolve the current branch tip.
    const ref = await githubFetch<GitHubRef>(
      `${repoUrl}/git/ref/heads/${encodeURIComponent(args.branch)}`,
      token,
    );
    const headSha = ref.object.sha;

    // 2. Create a blob for every changed file (deletes need no blob).
    const blobShas = new Map<string, string>();
    for (const file of textFiles) {
      const blob = await githubFetch<{ sha: string }>(
        `${repoUrl}/git/blobs`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            content: Buffer.from(file.content, "utf8").toString("base64"),
            encoding: "base64",
          }),
          headers: { "Content-Type": "application/json" },
        },
      );
      blobShas.set(file.path, blob.sha);
    }

    // 3. Rebuild the tree from the base commit: keep untouched blobs, swap in
    //    the new ones, and null out deleted paths (sha: null deletes).
    const baseTree = await githubFetch<{
      sha: string;
      tree: Array<{
        path: string;
        type: string;
        mode?: string;
        sha?: string | null;
      }>;
    }>(`${repoUrl}/git/trees/${headSha}?recursive=1`, token);

    const deleted = new Set(
      args.files.filter((f) => f.action === "delete").map((f) => f.path),
    );
    const tree: Array<{
      path: string;
      mode: string;
      type: "blob";
      sha: string | null;
    }> = baseTree.tree
      .filter(
        (entry) =>
          entry.type === "blob" &&
          !blobShas.has(entry.path) &&
          !deleted.has(entry.path),
      )
      .map((entry) => ({
        path: entry.path,
        mode: entry.mode ?? "100644",
        type: "blob" as const,
        sha: entry.sha ?? "",
      }));
    for (const file of textFiles) {
      tree.push({
        path: file.path,
        mode: "100644",
        type: "blob" as const,
        sha: blobShas.get(file.path)!,
      });
    }
    for (const path of deleted) {
      tree.push({
        path,
        mode: "100644",
        type: "blob" as const,
        sha: null,
      });
    }

    const newTree = await githubFetch<{ sha: string }>(`${repoUrl}/git/trees`, token, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTree.sha, tree }),
      headers: { "Content-Type": "application/json" },
    });

    // 4. Create the commit on top of the branch tip.
    const commit = await githubFetch<{
      sha: string;
      message: string;
      html_url: string | null;
    }>(`${repoUrl}/git/commits`, token, {
      method: "POST",
      body: JSON.stringify({
        message: args.message,
        tree: newTree.sha,
        parents: [headSha],
      }),
      headers: { "Content-Type": "application/json" },
    });

    // 5. Fast-forward the branch ref to the new commit.
    await githubFetch<GitHubRef>(
      `${repoUrl}/git/refs/heads/${encodeURIComponent(args.branch)}`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
        headers: { "Content-Type": "application/json" },
      },
    );

    return {
      sha: commit.sha,
      message: commit.message ?? args.message,
      htmlUrl: commit.html_url ?? null,
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
    const token = await getToken(ctx);
    const ref = await githubFetch<GitHubRef>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/git/ref/heads/${encodeURIComponent(
        args.base,
      )}`,
      token,
    );
    await githubFetch<GitHubRef>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/git/refs`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${args.name}`,
          sha: ref.object.sha,
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    return { name: args.name, sha: ref.object.sha } as BranchResult;
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
    const token = await getToken(ctx);
    const data = await githubFetch<GitHubPullRequest>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/pulls`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          title: args.title,
          head: args.head,
          base: args.base,
          body: args.body ?? "",
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
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
    const data = await githubFetch<GitHubMergeResponse>(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/pulls/${args.number}/merge`,
      token,
      {
        method: "PUT",
        body: JSON.stringify({ merge_method: "squash" }),
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
      // Some repos have no checks — that's fine.
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
      // No status contexts either.
    }

    const failedConclusions = new Set([
      "failure",
      "timed_out",
      "cancelled",
      "action_required",
    ]);
    const anyFailure =
      statusContexts.some((s) => s.state === "failure") ||
      checkRuns.some((c) => c.conclusion !== null && failedConclusions.has(c.conclusion));
    const anyPending =
      statusContexts.some((s) => s.state === "pending") ||
      checkRuns.some((c) => c.status === "in_progress" || c.status === "queued");

    let overall: "none" | "pending" | "failure" | "success";
    if (statusContexts.length === 0 && checkRuns.length === 0) {
      overall = "none";
    } else if (anyFailure) {
      overall = "failure";
    } else if (anyPending) {
      overall = "pending";
    } else {
      overall = "success";
    }

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
    const q = `${args.query.trim()} repo:${args.owner}/${args.repo}`;
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
