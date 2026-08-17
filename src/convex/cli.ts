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
