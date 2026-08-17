/**
 * CLI tokens — personal access tokens that let the Aria CLI (and future
 * integrations like a VS Code extension) talk to the same backend the app
 * uses, without ever sharing a GitHub OAuth token.
 *
 * Security model:
 * - Only the SHA-256 hash of a token is stored. The plaintext is returned
 *   exactly once, at creation, and is never retrievable again.
 * - Tokens are scoped to a single user and can only be listed/revoked by
 *   that user (ownership is checked server-side, never UI hiding).
 * - The CLI HTTP routes (src/convex/http.ts) verify the `Authorization:
 *   Bearer` header through internal.verifyCliToken and reject revoked
 *   tokens immediately.
 */
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { sha256Hex } from "./sha256";
import { fetchWithRetry } from "./net";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "aria";
const MAX_PRS_REPOS = 3;
const MAX_PRS_PER_REPO = 5;

const TOKEN_PREFIX = "aria_";

/** 32 random bytes as hex — Web Crypto when available (always in practice),
 *  with a plain fallback so token creation can never crash on exotic
 *  runtimes. */
function randomBytesHex(count: number): string {
  try {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const bytes = new Uint8Array(count);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // fall through
  }
  let out = "";
  for (let i = 0; i < count * 2; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/** Create a token and return the plaintext — shown once, then only the hash
 *  exists in the database. */
export const createCliToken = mutation({
  args: { label: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const label = args.label.trim().slice(0, 60) || "Aria CLI";
    const plaintext = TOKEN_PREFIX + randomBytesHex(32);
    await ctx.db.insert("cliTokens", {
      userId,
      tokenHash: sha256Hex(plaintext),
      prefix: `${plaintext.slice(0, 14)}…`,
      label,
      createdAt: Date.now(),
    });
    return { token: plaintext, label };
  },
});

export const listCliTokens = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("cliTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .filter((row) => !row.revokedAt)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        _id: row._id,
        prefix: row.prefix,
        label: row.label,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt ?? null,
      }));
  },
});

export const revokeCliToken = mutation({
  args: { tokenId: v.id("cliTokens") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const row = await ctx.db.get(args.tokenId);
    if (!row || row.userId !== userId) {
      throw new Error("Token not found.");
    }
    await ctx.db.patch(args.tokenId, { revokedAt: Date.now() });
  },
});

// ---------------------------------------------------------------------------
// Internal helpers for the CLI HTTP routes (src/convex/http.ts). They are
// internal so they can never be called directly from the client — the only
// way in is through the Bearer check below.
// ---------------------------------------------------------------------------

/** Verify a bearer token and return the user id (or null). Touches
 *  lastUsedAt on success so users can audit usage. */
export const verifyCliToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token.startsWith(TOKEN_PREFIX)) return null;
    const row = await ctx.db
      .query("cliTokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", sha256Hex(args.token)))
      .first();
    if (!row || row.revokedAt) return null;
    await ctx.db.patch(row._id, { lastUsedAt: Date.now() });
    return row.userId;
  },
});

export const whoamiByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    const connection = await ctx.db
      .query("githubConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    return {
      user: user ? { name: user.name ?? null } : null,
      github: connection
        ? { login: connection.login, name: connection.name ?? null }
        : null,
    };
  },
});

export const reposByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("connectedRepos")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    return rows
      .map((row) => ({ repo: row.repo, private: row.private }))
      .sort((a, b) => a.repo.localeCompare(b.repo));
  },
});

export const inboxByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("aiFindings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    return rows
      .filter((row) => !row.dismissedAt)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((row) => ({
        kind: row.kind,
        priority: row.priority,
        repo: row.repo,
        title: row.title,
        detail: row.detail,
        url: row.url ?? null,
        read: !!row.readAt,
        createdAt: row.createdAt,
      }));
  },
});

/** Open PRs across the user's connected repos (aggregated, newest first).
 *  Uses the user's own GitHub connection — the CLI token never sees GitHub
 *  credentials. */
export const prsByUser = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const connection = (await ctx.runQuery(internal.github.connectionForUser, {
      userId: args.userId,
    })) as { token: string } | null;
    if (connection === null) return [];
    const repos = (await ctx.runQuery(internal.github.listConnectedRepos, {
      userId: args.userId,
    })) as string[];
    const out: Array<{
      repo: string;
      number: number;
      title: string;
      htmlUrl: string;
      draft: boolean;
      updatedAt: string | null;
    }> = [];
    for (const repo of repos.slice(0, MAX_PRS_REPOS)) {
      try {
        const res = await fetchWithRetry(
          `${GITHUB_API}/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=${MAX_PRS_PER_REPO}`,
          {
            headers: {
              Authorization: `Bearer ${connection.token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": USER_AGENT,
            },
          },
        );
        if (!res.ok) continue;
        const data = (await res.json()) as Array<{
          number: number;
          title: string;
          html_url: string;
          draft: boolean;
          updated_at: string;
        }>;
        for (const pr of data) {
          out.push({
            repo,
            number: pr.number,
            title: pr.title.slice(0, 200),
            htmlUrl: pr.html_url,
            draft: pr.draft,
            updatedAt: pr.updated_at ?? null,
          });
        }
      } catch {
        // one repo failing must not kill the whole list
      }
    }
    return out.sort((a, b) =>
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
  },
});

// ---------------------------------------------------------------------------
// PR detail — the payload behind the extension's inline diff review. Same
// ownership rules as the other CLI endpoints: the PR must belong to a repo
// this user has connected, and everything is fetched with their own GitHub
// token. Returns the PR metadata plus, for each changed file, the full old
// and new contents (read at the base/head shas) so the client can render a
// real two-pane diff without a local checkout.
// ---------------------------------------------------------------------------

const MAX_DIFF_FILES = 30;
const MAX_FILE_CHARS = 2_000_000; // skip contents bigger than ~2MB

/** One GitHub REST call with retry + a parsed JSON body (throws on !ok). */
async function ghJson<T>(
  url: string,
  token: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<T> {
  const res = await fetchWithRetry(url, {
    method: init?.method ?? "GET",
    body: init?.body,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      ...init?.headers,
    },
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

/** Read a file's text at a ref via the contents API (null when binary,
 *  too large, or unreadable — the client renders such files without a
 *  content diff). */
async function readFileAt(
  repoUrl: string,
  token: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  try {
    const res = await ghJson<{
      content?: string;
      encoding?: string;
      truncated?: boolean;
    }>(`${repoUrl}/contents/${enc}?ref=${encodeURIComponent(ref)}`, token);
    if (!res.content || res.encoding !== "base64" || res.truncated) return null;
    const text = Buffer.from(res.content, "base64").toString("utf8");
    return text.length > MAX_FILE_CHARS ? null : text;
  } catch {
    return null; // 404 on rename corner cases, rate limits, etc. — never fail the review
  }
}

/** One PR, fully loaded: metadata + per-file old/new contents. */
export const prDetailByUser = internalAction({
  args: { userId: v.id("users"), repo: v.string(), number: v.number() },
  handler: async (ctx, args) => {
    const connected = (await ctx.runQuery(internal.github.listConnectedRepos, {
      userId: args.userId,
    })) as string[];
    if (!connected.includes(args.repo)) {
      throw new Error("That repo isn't connected to your Aria workspace.");
    }
    const connection = (await ctx.runQuery(internal.github.connectionForUser, {
      userId: args.userId,
    })) as { token: string } | null;
    if (connection === null) {
      throw new Error("GitHub is not connected.");
    }
    const token = connection.token;
    const [owner, name] = args.repo.split("/");
    const repoUrl = `${GITHUB_API}/repos/${owner}/${name}`;

    const pr = await ghJson<{
      number: number;
      title: string;
      state: string;
      draft: boolean;
      html_url: string;
      body: string | null;
      base: { ref: string; sha: string };
      head: { ref: string; sha: string };
    }>(`${repoUrl}/pulls/${args.number}`, token);

    const files = await ghJson<
      Array<{
        filename: string;
        previous_filename?: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
      }>
    >(`${repoUrl}/pulls/${args.number}/files?per_page=100`, token);

    const rows: Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch: string | null;
      oldContent: string | null;
      newContent: string | null;
    }> = [];
    for (const f of files.slice(0, MAX_DIFF_FILES)) {
      const oldPath =
        f.status === "renamed" && f.previous_filename
          ? f.previous_filename
          : f.filename;
      const oldContent =
        f.status === "added" ? null : await readFileAt(repoUrl, token, oldPath, pr.base.sha);
      const newContent =
        f.status === "removed" ? null : await readFileAt(repoUrl, token, f.filename, pr.head.sha);
      rows.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
        oldContent,
        newContent,
      });
    }

    return {
      repo: args.repo,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      htmlUrl: pr.html_url,
      body: pr.body ?? null,
      base: pr.base,
      head: pr.head,
      files: rows,
    };
  },
});
