"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "commit-app";

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

interface GitHubPullRequest {
  number: number;
  title: string;
  html_url: string;
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
    const data = await githubFetch<GitHubRepo[]>(
      `${GITHUB_API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator`,
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
  },
  handler: async (ctx, args) => {
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
  },
  handler: async (ctx, args) => {
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
