import { billingConfigured } from "./billingConfig";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { aiQuotaFor, periodKey, type PlanId } from "../lib/plans";

/**
 * AI usage metering — one row per user per calendar month in `aiUsage`.
 *
 * Enforcement lives here and in aiActions (the action layer), never in UI
 * hiding: every Ask Aria call checks the quota before running and increments
 * the counter after a successful reply, so failed calls don't burn quota.
 */

/** Count Ask Aria calls used this calendar month. */
async function countUsed(ctx: QueryCtx, userId: string): Promise<number> {
  const row = await ctx.db
    .query("aiUsage")
    .withIndex("by_userPeriod", (q) =>
      q.eq("userId", userId as never).eq("period", periodKey()),
    )
    .unique();
  return (row as { count?: number } | null)?.count ?? 0;
}

/** The signed-in user's usage this month, with their plan's quota. */
export const getAiUsage = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return {
        configured: false,
        period: periodKey(),
        plan: "free" as PlanId,
        used: 0,
        quota: null,
      };
    }
    const configured = billingConfigured();
    const billingRow = await ctx.db
      .query("billing")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    const plan: PlanId = billingRow?.plan ?? "free";
    const used = await countUsed(ctx, userId);
    return {
      configured,
      period: periodKey(),
      plan,
      used,
      quota: configured ? aiQuotaFor(plan) : null,
    };
  },
});

/** Internal snapshot for the AI action: quota check + plan, one round trip. */
export const usageForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const configured = billingConfigured();
    const billingRow = await ctx.db
      .query("billing")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const plan: PlanId = billingRow?.plan ?? "free";
    const used = await countUsed(ctx, args.userId);
    return {
      configured,
      plan,
      used,
      quota: configured ? aiQuotaFor(plan) : null,
    };
  },
});

/**
 * Team/Enterprise admin overview: seats, AI usage trend, and the recent audit
 * trail. Gated server-side — non-Team plans get `authorized: false` and the
 * UI shows nothing, never by hiding alone.
 */
export const adminOverview = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { authorized: false as const };
    const billingRow = await ctx.db
      .query("billing")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    const plan = billingRow?.plan ?? "free";
    if (plan !== "team" && plan !== "enterprise") {
      return { authorized: false as const };
    }

    // Usage trend: last 6 calendar months.
    const now = new Date();
    const periods: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      periods.push(periodKey(d));
    }
    const usageRows = await ctx.db
      .query("aiUsage")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const byPeriod = new Map(usageRows.map((r) => [r.period, r.count]));
    const usageTrend = periods.map((period) => ({
      period,
      count: byPeriod.get(period) ?? 0,
    }));
    const totalUsed = usageRows.reduce((n, r) => n + r.count, 0);

    const auditRows = await ctx.db
      .query("auditLogs")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const recentAudit = auditRows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((a) => ({
        action: a.action,
        repo: a.repo ?? null,
        detail: a.detail ?? null,
        createdAt: a.createdAt,
      }));

    return {
      authorized: true as const,
      plan,
      seats: billingRow?.seats ?? null,
      totalUsed,
      usageTrend,
      recentAudit,
    };
  },
});

/** Server-side increment after a successful AI call. */
export const recordAiUse = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const period = periodKey();
    const existing = await ctx.db
      .query("aiUsage")
      .withIndex("by_userPeriod", (q) =>
        q.eq("userId", args.userId).eq("period", period),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        count: existing.count + 1,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("aiUsage", {
        userId: args.userId,
        period,
        count: 1,
        updatedAt: Date.now(),
      });
    }
  },
});

// In-flight window: a slot is held for at most this long before it is
// treated as stale (crashed request) and can be re-acquired.
const INFLIGHT_TTL_MS = 60_000;

/**
 * Acquire the per-user in-flight slot before an AI call. Returns false when
 * another call is already running (or died < TTL ago) — the caller aborts,
 * so concurrent duplicate submissions can't double-fire a paid AI call.
 * Stale slots (older than TTL) are reclaimed automatically.
 */
export const acquireAiInflight = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiInflight")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const now = Date.now();
    if (existing) {
      if (now - existing.updatedAt < INFLIGHT_TTL_MS) {
        return false; // a request is already running
      }
      await ctx.db.patch(existing._id, { updatedAt: now });
      return true;
    }
    await ctx.db.insert("aiInflight", { userId: args.userId, updatedAt: now });
    return true;
  },
});

/** Release the in-flight slot after the AI call completes (or fails). */
export const releaseAiInflight = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiInflight")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Audit trail (Team/Enterprise): who did what and when. */
export const logAudit = internalMutation({
  args: {
    userId: v.id("users"),
    action: v.string(),
    repo: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      userId: args.userId,
      action: args.action,
      repo: args.repo,
      detail: args.detail,
      createdAt: Date.now(),
    });
  },
});
