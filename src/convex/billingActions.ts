"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { type GenericId } from "convex/values";
import { v } from "convex/values";
import Stripe from "stripe";

/**
 * Stripe actions (Node runtime — the Stripe SDK needs it). Only actions can
 * live in a "use node" file, so the queries/mutations stay in billing.ts.
 */

/** Lazy Stripe client — only constructed when keys exist. */
function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

/**
 * Create a subscription checkout session for the current user. Returns the
 * hosted Checkout URL; the client navigates to it directly.
 */
export const createCheckout = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You are not signed in.");
    const stripe = stripeClient();
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!stripe || !priceId) {
      throw new Error(
        "Billing isn't configured yet — add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to your project keys.",
      );
    }
    const origin = process.env.SITE_URL || "http://localhost:5173";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // client_reference_id ties the completed checkout back to this user,
      // and subscription_data.metadata lets later subscription events (which
      // don't carry client_reference_id) resolve the same user.
      client_reference_id: userId,
      subscription_data: { metadata: { userId } },
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
    if (!stripe) {
      throw new Error("Billing isn't configured yet.");
    }
    const customerId = await ctx.runQuery(internal.billing.billingForUser, {
      userId,
    });
    if (!customerId) {
      throw new Error("No subscription found for this account.");
    }
    const origin = process.env.SITE_URL || "http://localhost:5173";
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/dashboard?billing=success`,
    });
    return { url: session.url };
  },
});

// Stripe v22's Subscription type no longer exposes current_period_end even
// though the API returns it — read it via a narrow structural cast.
function periodEndMs(sub: {
  current_period_end?: number;
} | null | undefined): number | undefined {
  return sub?.current_period_end ? sub.current_period_end * 1000 : undefined;
}

/**
 * Verify a webhook signature with the Stripe SDK and sync the stored plan.
 * Called from the http action in stripeWebhook.ts.
 */
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

    const setPlan = (planArgs: {
      userId: string;
      plan: "free" | "pro";
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
      currentPeriodEnd?: number;
    }) =>
      ctx.runMutation(internal.billing.setPlan, {
        userId: planArgs.userId as GenericId<"users">,
        plan: planArgs.plan,
        stripeCustomerId: planArgs.stripeCustomerId,
        stripeSubscriptionId: planArgs.stripeSubscriptionId,
        currentPeriodEnd: planArgs.currentPeriodEnd,
      });

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (!session.client_reference_id) break;
        // Pull the subscription for the current period end (best-effort).
        let periodEnd: number | undefined;
        if (session.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(
              session.subscription as string,
            );
            periodEnd = periodEndMs(sub as { current_period_end?: number });
          } catch {
            // Plan still applies even if the period end can't be fetched.
          }
        }
        await setPlan({
          userId: session.client_reference_id,
          plan: "pro",
          stripeCustomerId: session.customer as string | undefined,
          stripeSubscriptionId: session.subscription as string | undefined,
          currentPeriodEnd: periodEnd,
        });
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;
        const active = sub.status === "active" || sub.status === "trialing";
        await setPlan({
          userId,
          plan: active ? "pro" : "free",
          stripeCustomerId: sub.customer as string,
          stripeSubscriptionId: sub.id,
          currentPeriodEnd: periodEndMs(sub as { current_period_end?: number }),
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
    return { ok: true };
  },
});
