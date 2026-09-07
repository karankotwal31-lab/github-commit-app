"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { type GenericId } from "convex/values";
import { v } from "convex/values";
import Stripe from "stripe";
import { priceIds, tierForPriceId } from "./billing";
import { type PlanId } from "../lib/plans";

/** Lazy Stripe client — only constructed when keys exist. */
function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

const TEAM_DEFAULT_SEATS = 5;
const TEAM_MAX_SEATS = 100;

/**
 * Billing redirects must never silently fall back to localhost in a deployed
 * app. SITE_URL is an explicit deployment contract for Stripe actions.
 */
function siteOrigin(): string {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) {
    throw new Error(
      "Billing is configured but SITE_URL is missing. Set SITE_URL to the public Aria origin.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("SITE_URL must be an absolute URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new Error("SITE_URL must use HTTPS outside local development.");
  }
  return url.origin;
}

function checkoutMetadataTier(value: unknown): Exclude<PlanId, "free" | "enterprise"> | null {
  return value === "pro" || value === "pro_plus" || value === "team"
    ? value
    : null;
}

/** Create a subscription checkout session for the current user. */
export const createCheckout = action({
  args: {
    tier: v.union(
      v.literal("pro"),
      v.literal("pro_plus"),
      v.literal("team"),
    ),
    seats: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const stripe = stripeClient();
    const priceId = priceIds()[args.tier];
    if (!stripe || !priceId) {
      throw new Error(
        `Billing isn't configured for ${args.tier} — add STRIPE_SECRET_KEY and the matching STRIPE_PRICE_ID_* key to your project keys.`,
      );
    }
    const quantity =
      args.tier === "team"
        ? Math.min(
            Math.max(1, Math.round(args.seats ?? TEAM_DEFAULT_SEATS)),
            TEAM_MAX_SEATS,
          )
        : 1;
    const origin = siteOrigin();
    const metadata = { userId, tier: args.tier };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity }],
      client_reference_id: userId,
      // Store the tier on both the Checkout Session and Subscription. The
      // session copy is the reliable fallback if line-item expansion fails.
      metadata,
      subscription_data: { metadata },
      success_url: `${origin}/dashboard?billing=success`,
      cancel_url: `${origin}/dashboard?billing=cancelled`,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
    });
    if (!session.url) throw new Error("Couldn't start checkout.");
    return { url: session.url };
  },
});

/** Customer portal URL to manage or cancel the subscription. */
export const createPortal = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const stripe = stripeClient();
    if (!stripe) throw new Error("Billing isn't configured yet.");
    const customerId = await ctx.runQuery(internal.billing.billingForUser, {
      userId,
    });
    if (!customerId) {
      throw new Error("No subscription found for this account.");
    }
    const origin = siteOrigin();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/dashboard?billing=success`,
    });
    return { url: session.url };
  },
});

/** Team tier seat-count update; Stripe handles proration. */
export const updateTeamSeats = action({
  args: { seats: v.number() },
  handler: async (ctx, args): Promise<{ seats: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const stripe = stripeClient();
    if (!stripe) throw new Error("Billing isn't configured yet.");
    const billing = await ctx.runQuery(internal.billing.planForUser, {
      userId,
    });
    if (billing.plan !== "team" || !billing.stripeSubscriptionId) {
      throw new Error("You need an active Team subscription to change seats.");
    }
    const seats = Math.min(
      Math.max(1, Math.round(args.seats)),
      TEAM_MAX_SEATS,
    );
    const sub = await stripe.subscriptions.retrieve(billing.stripeSubscriptionId);
    const item = sub.items.data[0];
    if (!item) throw new Error("No billable item on this subscription.");
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, quantity: seats }],
      proration_behavior: "create_prorations",
    });
    return { seats };
  },
});

function periodEndMs(sub: {
  current_period_end?: number;
} | null | undefined): number | undefined {
  return sub?.current_period_end ? sub.current_period_end * 1000 : undefined;
}

/** Verify a Stripe webhook and synchronize stored plan state. */
export const handleStripeWebhook = internalAction({
  args: { rawBody: v.string(), signature: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!secret || !key) {
      return { ok: false, error: "Stripe isn't configured" };
    }
    const stripe = new Stripe(key);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(args.rawBody, args.signature, secret);
    } catch {
      return { ok: false, error: "Invalid signature" };
    }

    const alreadyProcessed = await ctx
      .runQuery(internal.stripeEvents.wasProcessed, {
        provider: "stripe",
        eventId: event.id,
      })
      .catch(() => false);
    if (alreadyProcessed) return { ok: true };

    const setPlan = (planArgs: {
      userId: string;
      plan: PlanId;
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
      currentPeriodEnd?: number;
      seats?: number;
    }) =>
      ctx.runMutation(internal.billing.setPlan, {
        userId: planArgs.userId as GenericId<"users">,
        plan: planArgs.plan,
        stripeCustomerId: planArgs.stripeCustomerId,
        stripeSubscriptionId: planArgs.stripeSubscriptionId,
        currentPeriodEnd: planArgs.currentPeriodEnd,
        seats: planArgs.seats,
      });

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (!session.client_reference_id) break;

          let tier: Exclude<PlanId, "free" | "enterprise"> | null = null;
          let seats: number | undefined;
          let periodEnd: number | undefined;
          try {
            const full = await stripe.checkout.sessions.retrieve(session.id, {
              expand: ["line_items"],
            });
            const line = full.line_items?.data[0];
            const priceTier = tierForPriceId(line?.price?.id ?? null);
            tier = checkoutMetadataTier(priceTier);
            seats = line?.quantity ?? undefined;
            if (session.subscription) {
              const sub = await stripe.subscriptions.retrieve(
                session.subscription as string,
              );
              periodEnd = periodEndMs(sub as { current_period_end?: number });
            }
          } catch {
            // Network/API retrieval can fail transiently. Metadata was written
            // by our own checkout action and is the only safe fallback.
            tier = checkoutMetadataTier(session.metadata?.tier);
          }

          // Never grant a paid plan on an unknown price/tier. Returning an
          // error causes Stripe to retry instead of silently upgrading to Pro.
          if (!tier) {
            throw new Error("Unable to resolve the purchased Stripe price to an Aria plan.");
          }

          await setPlan({
            userId: session.client_reference_id,
            plan: tier,
            stripeCustomerId: session.customer as string | undefined,
            stripeSubscriptionId: session.subscription as string | undefined,
            currentPeriodEnd: periodEnd,
            seats: tier === "team" ? seats : undefined,
          });
          break;
        }
        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const userId = sub.metadata?.userId;
          if (!userId) break;
          const active = sub.status === "active" || sub.status === "trialing";
          const line = sub.items.data[0];
          const tier = tierForPriceId(line?.price?.id ?? null);
          await setPlan({
            userId,
            plan: active && tier ? tier : "free",
            stripeCustomerId: sub.customer as string,
            stripeSubscriptionId: sub.id,
            currentPeriodEnd: periodEndMs(sub as { current_period_end?: number }),
            seats:
              active && tier === "team" ? line?.quantity ?? undefined : undefined,
          });
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const userId = sub.metadata?.userId;
          if (!userId) break;
          await setPlan({
            userId,
            plan: "free",
            stripeCustomerId: sub.customer as string,
            stripeSubscriptionId: sub.id,
            currentPeriodEnd: undefined,
          });
          break;
        }
        default:
          break;
      }
    } catch (e) {
      await ctx
        .runMutation(internal.security.logError, {
          source: "stripe",
          message:
            e instanceof Error
              ? `webhook processing failed: ${e.message.slice(0, 300)}`
              : "webhook processing failed",
        })
        .catch(() => {});
      return {
        ok: false,
        error:
          e instanceof Error ? e.message.slice(0, 200) : "webhook processing failed",
      };
    }

    try {
      await ctx.runMutation(internal.stripeEvents.markProcessed, {
        provider: "stripe",
        eventId: event.id,
      });
    } catch (e) {
      await ctx
        .runMutation(internal.security.logError, {
          source: "stripe",
          message:
            e instanceof Error
              ? `dedup write failed: ${e.message.slice(0, 200)}`
              : "dedup write failed",
        })
        .catch(() => {});
    }
    return { ok: true };
  },
});
