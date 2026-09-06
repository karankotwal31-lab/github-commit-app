/** Server-only configuration shared by every entitlement gate. */
export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && [
    "STRIPE_PRICE_ID", "STRIPE_PRICE_ID_PRO", "STRIPE_PRICE_ID_PRO_PLUS", "STRIPE_PRICE_ID_TEAM",
  ].some((key) => process.env[key]?.trim()));
}
