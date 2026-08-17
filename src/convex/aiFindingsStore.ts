import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { findingPriority, sortFindings } from "../lib/phase4";

/**
 * Read/write side of the background AI checker (the scan itself runs in the
 * "use node" aiFindings.ts because it calls out to GitHub + the npm registry).
 * Queries and mutations can't live in Node modules, so the store lives here.
 *
 * Phase 4 F: findings carry priority, read state, and a dismiss (reviewed)
 * state so the unified inbox can rank actionable items and track what the
 * user has actually seen.
 */

const MAX_FINDINGS_PER_USER = 25;

/** Reactive list of the signed-in user's findings — priority first, then newest. */
export const listFindings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("aiFindings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return sortFindings(rows).slice(0, MAX_FINDINGS_PER_USER);
  },
});

/** Count unread findings (badge on the inbox button). */
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return 0;
    const rows = await ctx.db
      .query("aiFindings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows.filter(
      (r) => r.readAt === undefined && r.dismissedAt === undefined,
    ).length;
  },
});

/** Mark a finding read (opened). Dismissed findings stay hidden. */
export const markFindingRead = mutation({
  args: { id: v.id("aiFindings") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const row = await ctx.db.get(args.id);
    if (row === null || row.userId !== userId) return;
    if (row.readAt === undefined) {
      await ctx.db.patch(args.id, { readAt: Date.now() });
    }
  },
});

/** Mark every unread finding read in one action (inbox "Mark all read"). */
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const rows = await ctx.db
      .query("aiFindings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const now = Date.now();
    for (const row of rows) {
      if (row.readAt === undefined && row.dismissedAt === undefined) {
        await ctx.db.patch(row._id, { readAt: now });
      }
    }
  },
});

/** Dismiss a finding (the user has reviewed it — hidden from the inbox). */
export const dismissFinding = mutation({
  args: { id: v.id("aiFindings") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const row = await ctx.db.get(args.id);
    if (row === null || row.userId !== userId) {
      throw new Error("Finding not found.");
    }
    await ctx.db.patch(args.id, { dismissedAt: Date.now() });
  },
});

/** Internal: upsert one finding by (userId, key) so fixed issues vanish on the
 *  next scan. Called from the Node scanner action. */
export const upsertFinding = internalMutation({
  args: {
    userId: v.id("users"),
    key: v.string(),
    kind: v.union(
      v.literal("dependency"),
      v.literal("stale_pr"),
      v.literal("config_change"),
      v.literal("failing_ci"),
      v.literal("security"),
      v.literal("dependency_upgrade"),
      v.literal("docs"),
      v.literal("mission"),
    ),
    repo: v.string(),
    title: v.string(),
    detail: v.string(),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("aiFindings")
      .withIndex("by_userKey", (q) => q.eq("userId", args.userId).eq("key", args.key))
      .unique();
    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        detail: args.detail,
        url: args.url,
        createdAt: now,
      });
    } else {
      await ctx.db.insert("aiFindings", {
        userId: args.userId,
        key: args.key,
        kind: args.kind,
        priority: findingPriority(args.kind),
        repo: args.repo,
        title: args.title.slice(0, 140),
        detail: args.detail.slice(0, 400),
        url: args.url,
        createdAt: now,
      });
    }
  },
});

/** Internal: prune a user's findings to the cap (newest kept). */
export const pruneFindings = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("aiFindings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    if (rows.length <= MAX_FINDINGS_PER_USER) return;
    const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);
    for (const old of sorted.slice(MAX_FINDINGS_PER_USER)) {
      await ctx.db.delete(old._id);
    }
  },
});
