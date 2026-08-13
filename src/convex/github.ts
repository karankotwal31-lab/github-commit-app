import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v, type GenericId } from "convex/values";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function randomHex(bytes: number) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Public connection status for the signed-in user. */
export const connection = query({
  args: {},
  handler: async (ctx): Promise<{
    connected: boolean;
    login: string | null;
    name: string | null;
    avatar: string | null;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { connected: false, login: null, name: null, avatar: null };
    const conn = await ctx.db
      .query("githubConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (conn === null) return { connected: false, login: null, name: null, avatar: null };
    return {
      connected: true,
      login: conn.login,
      name: conn.name ?? null,
      avatar: conn.avatar ?? null,
    };
  },
});

/** Whether the GitHub OAuth credentials are configured on the backend. */
export const config = query({
  args: {},
  handler: () => ({
    clientIdConfigured: !!process.env.GITHUB_CLIENT_ID,
    clientSecretConfigured: !!process.env.GITHUB_CLIENT_SECRET,
    // The client ID is public by design (it appears in every authorize URL);
    // the secret never leaves the server.
    clientId: process.env.GITHUB_CLIENT_ID ?? null,
  }),
});

/** Internal: the raw connection (incl. token) for a user. Actions only. */
export const connectionForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const conn = await ctx.db
      .query("githubConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (conn === null) return null;
    return {
      token: conn.token,
      login: conn.login,
      name: conn.name ?? null,
      avatar: conn.avatar ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// Public mutations
// ---------------------------------------------------------------------------

/**
 * Start a GitHub OAuth flow for the signed-in user. Runs inside the app (where
 * the session works), creates a one-time state token bound to the user, and
 * returns it so the client can send the user to GitHub.
 */
export const startOAuth = mutation({
  args: { origin: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const state = randomHex(32);
    await ctx.db.insert("githubOAuthStates", {
      state,
      userId,
      origin: args.origin,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    return state;
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const conn = await ctx.db
      .query("githubConnections")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (conn !== null) await ctx.db.delete(conn._id);
    // Drop the saved workspace so another device doesn't try to restore it.
    const state = await ctx.db
      .query("workspaceStates")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (state !== null) await ctx.db.delete(state._id);
  },
});

/** The user's last workspace (repo, branch, open file, draft, cursor). */
export const getWorkspaceState = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const state = await ctx.db
      .query("workspaceStates")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (state === null) return null;
    return {
      repo: state.repo,
      branch: state.branch,
      path: state.path ?? null,
      openPath: state.openPath ?? null,
      draft: state.draft ?? null,
      cursorLine: state.cursorLine ?? null,
      cursorColumn: state.cursorColumn ?? null,
      updatedAt: state.updatedAt,
    };
  },
});

/** Save the user's workspace so another device can continue where they left off. */
export const saveWorkspaceState = mutation({
  args: {
    repo: v.string(),
    branch: v.string(),
    path: v.optional(v.string()),
    openPath: v.optional(v.string()),
    draft: v.optional(v.string()),
    cursorLine: v.optional(v.number()),
    cursorColumn: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const existing = await ctx.db
      .query("workspaceStates")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    const doc = {
      userId,
      repo: args.repo,
      branch: args.branch,
      path: args.path,
      openPath: args.openPath,
      // Cap the draft so a huge file doesn't bloat the row.
      draft: args.draft && args.draft.length <= 500_000 ? args.draft : undefined,
      cursorLine: args.cursorLine,
      cursorColumn: args.cursorColumn,
      updatedAt: Date.now(),
    };
    if (existing !== null) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("workspaceStates", doc);
    }
  },
});

// ---------------------------------------------------------------------------
// Internal mutations (called from HTTP actions only)
// ---------------------------------------------------------------------------

export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args): Promise<{
    userId: GenericId<"users">;
    origin: string | null;
  }> => {
    const doc = await ctx.db
      .query("githubOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (doc === null) throw new Error("Invalid OAuth state.");
    await ctx.db.delete(doc._id);
    if (doc.expiresAt < Date.now()) throw new Error("OAuth state expired.");
    return { userId: doc.userId, origin: doc.origin ?? null };
  },
});

export const saveConnection = internalMutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    login: v.string(),
    name: v.optional(v.string()),
    avatar: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        token: args.token,
        login: args.login,
        name: args.name,
        avatar: args.avatar,
      });
      return;
    }
    await ctx.db.insert("githubConnections", {
      userId: args.userId,
      token: args.token,
      login: args.login,
      name: args.name,
      avatar: args.avatar,
    });
  },
});
