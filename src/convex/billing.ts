import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { type PlanId } from "../lib/plans";
import { billingConfigured, legacyProPriceId } from "./billingConfig";

/**
 * Billing state for the plan ladder (free → pro → pro_plus → team →
 * enterprise) — queries/mutations only (no Node APIs). The Stripe actions
 * live in billingActions.ts ("use node") because only actions can run in the
 * Node.js runtime.
 *
 * - `plan` query: the signed-in user's plan + seats. When Stripe isn't
 *   configured the app stays fully unlocked (`configured: false`).
 * - `setPlan` internal mutation: called by the Stripe webhook
 *   (billingActions.ts) to keep the stored plan in sync with reality.
 */

export const planValidator = v.union(
  v.literal("free"),
  v.literal("pro"),
  v.literal("pro_plus"),
  v.literal("team"),
  v.literal("enterprise"),
);

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

/** Stripe price ids per tier, from env (STRIPE_PRICE_ID is the Pro legacy). */
export function priceIds(): Record<string, string | null> {
  return {
    pro: env("STRIPE_PRICE_ID_PRO") ?? legacyProPriceId(),
    pro_plus: env("STRIPE_PRICE_ID_PRO_PLUS"),
    team: env("STRIPE_PRICE_ID_TEAM"),
  };
}

/** Map a Stripe price id back to its tier (used by the webhook). */
export function tierForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  const ids = priceIds();
  for (const [tier, id] of Object.entries(ids)) {
    if (id === priceId) return tier as PlanId;
  }
  return null;
}

/** Whether a tier is purchasable at self-serve checkout. */
export function isCheckoutTier(tier: string): tier is "pro" | "pro_plus" | "team" {
  return tier === "pro" || tier === "pro_plus" || tier === "team";
}

export const billingConfig = query({
  args: {},
  handler: () => {
    const configured = billingConfigured();
    return {
      configured,
      priceId: priceIds().pro ?? null,
      prices: priceIds(),
    };
  },
});

/** The signed-in user's current plan (free unless Stripe says otherwise). */
export const plan = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const configured = billingConfigured();
    if (userId === null || !configured) {
      return {
        configured,
        plan: "free" as PlanId,
        currentPeriodEnd: null,
        seats: null,
      };
    }
    const row = await ctx.db
      .query("billing")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (row === null) {
      return {
        configured,
        plan: "free" as PlanId,
        currentPeriodEnd: null,
        seats: null,
      };
    }
    return {
      configured,
      plan: row.plan as PlanId,
      currentPeriodEnd: row.currentPeriodEnd ?? null,
      seats: row.seats ?? null,
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

/** Internal: full billing snapshot for the current user (for actions). */
export const planForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("billing")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    return {
      plan: (row?.plan ?? "free") as PlanId,
      seats: row?.seats ?? null,
      stripeSubscriptionId: row?.stripeSubscriptionId ?? null,
      currentPeriodEnd: row?.currentPeriodEnd ?? null,
    };
  },
});

/** Internal: update the stored Stripe customer/subscription state. */
export const setPlan = internalMutation({
  args: {
    userId: v.id("users"),
    plan: planValidator,
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    seats: v.optional(v.number()),
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
      seats: args.seats,
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
