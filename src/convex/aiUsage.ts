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

/** Whether billing is configured (keys present) — mirrors billing.ts. */
function billingConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

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
