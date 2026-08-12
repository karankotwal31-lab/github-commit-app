"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "commit-app";

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

async function githubFetch(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: githubHeaders(
      token,
      init?.headers as Record<string, string> | undefined,
    ),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      data?.message ?? `GitHub request failed (${res.status} ${res.statusText})`;
    throw new Error(message);
  }
  return data;
}

/** Resolve the signed-in user's GitHub access token, or throw if absent. */
async function getToken(ctx: any): Promise<string> {
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
    const data = await githubFetch(
      `${GITHUB_API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator`,
      token,
    );
    return data.map((repo: any) => ({
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
    const data = await githubFetch(url, token);
    if (!Array.isArray(data)) return [];
    return data.map((item: any) => ({
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
    const data = await githubFetch(url, token);
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
    const data = await githubFetch(
      `${GITHUB_API}/repos/${args.owner}/${args.repo}/contents/${encodePath(args.path)}`,
      token,
      {
        method: "PUT",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
    );
    return {
      sha: data?.commit?.sha ?? null,
      message: data?.commit?.message ?? args.message,
      htmlUrl: data?.commit?.html_url ?? null,
    };
  },
});
