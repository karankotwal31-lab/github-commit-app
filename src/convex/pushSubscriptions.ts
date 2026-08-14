import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v, type GenericId } from "convex/values";

/**
 * Push-subscription storage — queries/mutations only (default runtime).
 * The sending logic lives in notifications.ts ("use node") because web-push
 * needs the Node.js runtime; Convex only allows actions there.
 */

/** Whether the push stack is configured on the backend. */
export const pushConfig = query({
  args: {},
  handler: () => ({ configured: !!(process.env.VAPID_PRIVATE_KEY && process.env.VAPID_PUBLIC_KEY) }),
});

/** How many devices this user has subscribed. */
export const myPushSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { count: 0 };
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return { count: rows.length };
  },
});

/** Store a browser PushSubscription for the signed-in user. */
export const savePushSubscription = mutation({
  args: {
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
    deviceLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing) {
      await ctx.db.replace(existing._id, {
        userId,
        endpoint: args.endpoint,
        keys: args.keys,
        deviceLabel: args.deviceLabel,
        createdAt: existing.createdAt,
      });
    } else {
      await ctx.db.insert("pushSubscriptions", {
        userId,
        endpoint: args.endpoint,
        keys: args.keys,
        deviceLabel: args.deviceLabel,
        createdAt: Date.now(),
      });
    }
  },
});

/** Remove a PushSubscription (user turned notifications off / re-subscribed). */
export const deletePushSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing && existing.userId === userId) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ---------------------------------------------------------------------------
// Internal helpers (used by the Node-runtime actions in notifications.ts)
// ---------------------------------------------------------------------------

/** Distinct users who have at least one push subscription. */
export const usersWithSubscriptions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("pushSubscriptions").collect();
    return [...new Set(rows.map((r) => r.userId))] as GenericId<"users">[];
  },
});

/** A user's push subscriptions (endpoint + keys for web-push). */
export const subsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    return rows.map((r) => ({
      endpoint: r.endpoint,
      keys: { p256dh: r.keys.p256dh, auth: r.keys.auth },
    }));
  },
});

/** Remove a dead subscription endpoint (push service reported 404/410). */
export const pruneSubscription = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Mark an inbox item as pushed (dedup — each item notifies once). */
export const markSent = internalMutation({
  args: { userId: v.id("users"), key: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sentNotifications")
      .withIndex("by_userKey", (q) =>
        q.eq("userId", args.userId).eq("key", args.key),
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("sentNotifications", {
        userId: args.userId,
        key: args.key,
        sentAt: Date.now(),
      });
    }
  },
});

/** Has this inbox item already been pushed to this user? */
export const wasSent = internalQuery({
  args: { userId: v.id("users"), key: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sentNotifications")
      .withIndex("by_userKey", (q) =>
        q.eq("userId", args.userId).eq("key", args.key),
      )
      .unique();
    return row !== null;
  },
});
