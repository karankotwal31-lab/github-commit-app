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
// Draft vault
// ---------------------------------------------------------------------------

const DRAFT_MAX_CHARS = 500_000;
const DRAFT_SNIPPET_CHARS = 240;

/** Save an unsaved draft for a (repo, branch, path). Upserts by key. */
export const saveDraft = mutation({
  args: {
    repo: v.string(),
    branch: v.string(),
    path: v.string(),
    content: v.string(),
    cursorLine: v.optional(v.number()),
    cursorColumn: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const existing = await ctx.db
      .query("drafts")
      .withIndex("by_userKey", (q) =>
        q.eq("userId", userId).eq("repo", args.repo).eq("branch", args.branch).eq("path", args.path),
      )
      .unique();
    const doc = {
      userId,
      repo: args.repo,
      branch: args.branch,
      path: args.path,
      content: args.content.length <= DRAFT_MAX_CHARS ? args.content : args.content.slice(0, DRAFT_MAX_CHARS),
      cursorLine: args.cursorLine,
      cursorColumn: args.cursorColumn,
      updatedAt: Date.now(),
    };
    if (existing !== null) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("drafts", doc);
    }
  },
});

/** Drop a draft after it's been committed (or deliberately discarded). */
export const deleteDraft = mutation({
  args: {
    repo: v.string(),
    branch: v.string(),
    path: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const existing = await ctx.db
      .query("drafts")
      .withIndex("by_userKey", (q) =>
        q.eq("userId", userId).eq("repo", args.repo).eq("branch", args.branch).eq("path", args.path),
      )
      .unique();
    if (existing !== null) await ctx.db.delete(existing._id);
  },
});

/** Full draft content for a single file. */
export const getDraft = query({
  args: {
    repo: v.string(),
    branch: v.string(),
    path: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const existing = await ctx.db
      .query("drafts")
      .withIndex("by_userKey", (q) =>
        q.eq("userId", userId).eq("repo", args.repo).eq("branch", args.branch).eq("path", args.path),
      )
      .unique();
    if (existing === null) return null;
    return {
      repo: existing.repo,
      branch: existing.branch,
      path: existing.path,
      content: existing.content,
      cursorLine: existing.cursorLine ?? null,
      cursorColumn: existing.cursorColumn ?? null,
      updatedAt: existing.updatedAt,
    };
  },
});

/**
 * Full draft content for the vault dialog. listDrafts only returns metadata +
 * preview so the list stays light; this fetches the full copy on demand when
 * the user actually restores a draft.
 */
export const getDraftContent = mutation({
  args: {
    repo: v.string(),
    branch: v.string(),
    path: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const existing = await ctx.db
      .query("drafts")
      .withIndex("by_userKey", (q) =>
        q.eq("userId", userId).eq("repo", args.repo).eq("branch", args.branch).eq("path", args.path),
      )
      .unique();
    if (existing === null) return null;
    return {
      content: existing.content,
      cursorLine: existing.cursorLine ?? null,
      cursorColumn: existing.cursorColumn ?? null,
    };
  },
});

/** Vault listing (metadata + preview only — content loads per file). */
export const listDrafts = query({
  args: {},
  handler: async (ctx): Promise<
    Array<{
      repo: string;
      branch: string;
      path: string;
      preview: string;
      updatedAt: number;
    }>
  > => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const drafts = await ctx.db
      .query("drafts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return drafts
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 200)
      .map((d) => ({
        repo: d.repo,
        branch: d.branch,
        path: d.path,
        preview:
          d.content.slice(0, DRAFT_SNIPPET_CHARS).replace(/\s+/g, " ").trim() ||
          "(empty draft)",
        updatedAt: d.updatedAt,
      }));
  },
});

// ---------------------------------------------------------------------------
// Live presence (which devices are in the workspace right now)
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 60_000; // a session is stale after a minute of silence

/** Heartbeat: upsert this tab's session so other devices see it. */
export const updateLiveSession = mutation({
  args: {
    deviceId: v.string(),
    label: v.string(),
    repo: v.optional(v.string()),
    branch: v.optional(v.string()),
    path: v.optional(v.string()),
    cursorLine: v.optional(v.number()),
    cursorColumn: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const existing = await ctx.db
      .query("liveSessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("deviceId"), args.deviceId))
      .unique();
    const doc = {
      userId,
      deviceId: args.deviceId,
      label: args.label,
      repo: args.repo,
      branch: args.branch,
      path: args.path,
      cursorLine: args.cursorLine,
      cursorColumn: args.cursorColumn,
      updatedAt: Date.now(),
    };
    if (existing !== null) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("liveSessions", doc);
      // A brand-new tab means something else may have gone stale (closed tab,
      // crashed browser, refresh). Prune this user's silent sessions so the
      // table doesn't accumulate one row per tab that was ever opened.
      const stale = await ctx.db
        .query("liveSessions")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .filter((q) => q.lt(q.field("updatedAt"), Date.now() - SESSION_TTL_MS))
        .collect();
      for (const session of stale) {
        await ctx.db.delete(session._id);
      }
    }
  },
});

/** Remove this tab's session (on unmount / sign-out). */
export const clearLiveSession = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;
    const existing = await ctx.db
      .query("liveSessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("deviceId"), args.deviceId))
      .unique();
    if (existing !== null) await ctx.db.delete(existing._id);
  },
});

/** Other live devices (excluding this tab), fresher than a minute. */
export const listLiveSessions = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const now = Date.now();
    const sessions = await ctx.db
      .query("liveSessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return sessions
      .filter((s) => s.deviceId !== args.deviceId && now - s.updatedAt < SESSION_TTL_MS)
      .map((s) => ({
        deviceId: s.deviceId,
        label: s.label,
        repo: s.repo ?? null,
        branch: s.branch ?? null,
        path: s.path ?? null,
        cursorLine: s.cursorLine ?? null,
        cursorColumn: s.cursorColumn ?? null,
      }));
  },
});

// ---------------------------------------------------------------------------
// Team workspaces: share the current repo + branch with teammates via a code.
// Everyone joins with their own GitHub connection; drafts and presence stay
// per-user.
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function randomCode(length: number): string {
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** Create a share code for the current repo + branch. Returns the code. */
export const createSharedWorkspace = mutation({
  args: {
    repo: v.string(),
    branch: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    // Collision-resistant: retry a few times if the code already exists.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `ARIA-${randomCode(5)}`;
      const existing = await ctx.db
        .query("sharedWorkspaces")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      if (existing === null) {
        await ctx.db.insert("sharedWorkspaces", {
          code,
          repo: args.repo,
          branch: args.branch,
          label: args.label,
          createdBy: userId,
          createdAt: Date.now(),
        });
        return code;
      }
    }
    throw new Error("Couldn't generate a unique code — try again.");
  },
});

/** Resolve a share code to its workspace (repo + branch), or null. */
export const joinSharedWorkspace = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const normalized = args.code.trim().toUpperCase();
    if (!normalized) return null;
    const doc = await ctx.db
      .query("sharedWorkspaces")
      .withIndex("by_code", (q) => q.eq("code", normalized))
      .unique();
    if (doc === null) return null;
    return { repo: doc.repo, branch: doc.branch, label: doc.label ?? null };
  },
});

/** The share codes this user has created. */
export const mySharedWorkspaces = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const docs = await ctx.db
      .query("sharedWorkspaces")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .collect();
    return docs
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((d) => ({
        code: d.code,
        repo: d.repo,
        branch: d.branch,
        label: d.label ?? null,
        createdAt: d.createdAt,
      }));
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
