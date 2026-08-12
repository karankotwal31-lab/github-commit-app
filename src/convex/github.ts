import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v, type GenericId } from "convex/values";

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
  },
});

// ---------------------------------------------------------------------------
// Internal mutations (called from HTTP actions only)
// ---------------------------------------------------------------------------

export const storeOAuthState = internalMutation({
  args: {
    state: v.string(),
    userId: v.id("users"),
    origin: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("githubOAuthStates", {
      state: args.state,
      userId: args.userId,
      origin: args.origin,
      expiresAt: args.expiresAt,
    });
  },
});

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
