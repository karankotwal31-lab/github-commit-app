import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { withSecurityHeaders } from "./httpSecurity";

/**
 * Stripe webhook route (non-node http action). Signature verification and
 * plan updates run in the internal action handleStripeWebhook (billingActions.ts,
 * node runtime), because the Stripe SDK needs Node and only actions may live
 * in "use node" files.
 */
export const stripeWebhook = httpAction(async (ctx, request) => {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return withSecurityHeaders(new Response("Missing signature", { status: 400 }));
  }
  const rawBody = await request.text();

  const result = await ctx.runAction(
    internal.billingActions.handleStripeWebhook,
    { rawBody, signature },
  );
  if (!result.ok) {
    return withSecurityHeaders(new Response(result.error ?? "Invalid webhook", { status: 400 }));
  }
  return withSecurityHeaders(new Response("ok", { status: 200 }));
});
