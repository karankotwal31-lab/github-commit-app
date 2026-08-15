import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";

/**
 * Phase 4 L — Webhook event dedup.
 *
 * Stripe may deliver the same event more than once (network retries, manual
 * replays from the dashboard). `processedEvents` records every event that was
 * actually applied; `wasProcessed` short-circuits replays so a plan change is
 * applied exactly once. Rows are pruned after a retention window to keep the
 * table bounded.
 */

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const wasProcessed = internalQuery({
  args: { provider: v.string(), eventId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("processedEvents")
      .withIndex("by_event", (q) =>
        q.eq("provider", args.provider).eq("eventId", args.eventId),
      )
      .unique();
    return row !== null;
  },
});

export const markProcessed = internalMutation({
  args: { provider: v.string(), eventId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("processedEvents", {
      provider: args.provider,
      eventId: args.eventId,
      processedAt: Date.now(),
    });
  },
});

/** Prune rows older than the retention window (called by the cron). */
export const pruneProcessed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS;
    const rows = await ctx.db
      .query("processedEvents")
      .withIndex("by_processedAt", (q) => q.lte("processedAt", cutoff))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

export type ProcessedEventsCtx = QueryCtx;
