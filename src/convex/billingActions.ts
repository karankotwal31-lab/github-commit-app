"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { type GenericId } from "convex/values";
import { v } from "convex/values";
import Stripe from "stripe";
import { priceIds, tierForPriceId } from "./billing";
import { type PlanId } from "../lib/plans";

/**
 * Stripe actions (Node runtime — the Stripe SDK needs it). Only actions can
 * live in a "use node" file, so the queries/mutations stay in billing.ts.
 *
 * Price ids come from env: STRIPE_PRICE_ID (legacy Pro) / STRIPE_PRICE_ID_PRO
 * / STRIPE_PRICE_ID_PRO_PLUS / STRIPE_PRICE_ID_TEAM. The webhook maps the
 * purchased price back to a tier, so one code path serves every plan.
 */

/** Lazy Stripe client — only constructed when keys exist. */
function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

const TEAM_DEFAULT_SEATS = 5;
const TEAM_MAX_SEATS = 100;

/**
 * Create a subscription checkout session for the current user at a given
 * tier. Returns the hosted Checkout URL; the client navigates to it directly.
 */
export const createCheckout = action({
  args: {
    tier: v.union(
      v.literal("pro"),
      v.literal("pro_plus"),
      v.literal("team"),
    ),
    // Team tier: how many seats to buy up front (prorated add/remove after).
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
    const origin = process.env.SITE_URL || "http://localhost:5173";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity }],
      // client_reference_id ties the completed checkout back to this user,
      // and subscription_data.metadata lets later subscription events (which
      // don't carry client_reference_id) resolve the same user.
      client_reference_id: userId,
      subscription_data: { metadata: { userId, tier: args.tier } },
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

/**
 * Team tier: change the seat count on the existing subscription. Stripe
 * prorates automatically — adding seats bills the difference for the rest of
 * the period, removing seats credits it.
 */
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

// Stripe v22's Subscription type no longer exposes current_period_end even
// though the API returns it — read it via a narrow structural cast.
function periodEndMs(sub: {
  current_period_end?: number;
} | null | undefined): number | undefined {
  return sub?.current_period_end ? sub.current_period_end * 1000 : undefined;
}

/**
 * Verify a webhook signature with the Stripe SDK and sync the stored plan.
 * The purchased price id is mapped back to a tier, so any plan's checkout /
 * update / cancel flows through the same code.
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

    // Idempotency (Phase 4 L): Stripe retries deliveries of the same event
    // (and replays from the dashboard). Each event is processed at most once
    // — a replay returns success without touching the plan again, so a
    // duplicate webhook can never double-apply a plan change.
    const alreadyProcessed = await ctx
      .runQuery(internal.stripeEvents.wasProcessed, {
        provider: "stripe",
        eventId: event.id,
      })
      .catch(() => false);
    if (alreadyProcessed) {
      return { ok: true };
    }

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

    // Failures inside the switch are logged (errorLogs → Airbrake mirror)
    // and returned to Stripe as an error so it retries the delivery.
    try {
      switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (!session.client_reference_id) break;
        // Resolve the purchased price → tier (line items aren't on the
        // session object unless expanded).
        let tier: PlanId | null = null;
        let seats: number | undefined;
        let periodEnd: number | undefined;
        try {
          const full = await stripe.checkout.sessions.retrieve(session.id, {
            expand: ["line_items"],
          });
          const line = full.line_items?.data[0];
          tier = tierForPriceId(line?.price?.id ?? null);
          seats = line?.quantity ?? undefined;
          if (session.subscription) {
            const sub = await stripe.subscriptions.retrieve(
              session.subscription as string,
            );
            periodEnd = periodEndMs(sub as { current_period_end?: number });
          }
        } catch {
          // Fall back to the tier tagged at checkout creation.
          tier = session.metadata?.tier as PlanId | null;
        }
        await setPlan({
          userId: session.client_reference_id,
          plan: tier && tier !== "free" ? tier : "pro",
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
          seats: active && tier === "team" ? line?.quantity ?? undefined : undefined,
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
      // The dedup row is best-effort; a failure here must not break the plan
      // update that already happened — log it for review instead.
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
