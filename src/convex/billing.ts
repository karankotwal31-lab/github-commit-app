import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Billing state for the Pro tier — queries/mutations only (no Node APIs).
 * The Stripe actions live in billingActions.ts ("use node") because only
 * actions can run in the Node.js runtime.
 *
 * - `plan` query: the signed-in user's plan (free / pro). When Stripe isn't
 *   configured the app stays fully unlocked (`configured: false`).
 * - `setPlan` internal mutation: called by the Stripe webhook (stripeWebhook.ts)
 *   to keep the stored plan in sync with reality.
 */

/** Whether billing is configured on the backend (keys + a price set). */
export const billingConfig = query({
  args: {},
  handler: () => ({
    configured: !!(
      process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID
    ),
    priceId: process.env.STRIPE_PRICE_ID ?? null,
  }),
});

/** The signed-in user's current plan (free unless Stripe says otherwise). */
export const plan = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const configured = !!(
      process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID
    );
    if (userId === null || !configured) {
      return { configured, plan: "free" as const, currentPeriodEnd: null };
    }
    const row = await ctx.db
      .query("billing")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (row === null) {
      return { configured, plan: "free" as const, currentPeriodEnd: null };
    }
    return {
      configured,
      plan: row.plan,
      currentPeriodEnd: row.currentPeriodEnd ?? null,
    };
  },
});

/** Internal: the stored Stripe customer id for a user (for the portal). */
export const billingForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("billing")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    return row?.stripeCustomerId ?? null;
  },
});

/** Internal: update the stored plan (called by the Stripe webhook). */
export const setPlan = internalMutation({
  args: {
    userId: v.id("users"),
    plan: v.union(v.literal("free"), v.literal("pro")),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("billing")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const doc = {
      userId: args.userId,
      plan: args.plan,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      currentPeriodEnd: args.currentPeriodEnd,
      updatedAt: Date.now(),
    };
    if (existing !== null) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("billing", doc);
    }
    return args.plan;
  },
});
