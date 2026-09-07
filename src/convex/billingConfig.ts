/**
 * Shared Stripe configuration predicates.
 *
 * Aria historically used STRIPE_PRICE_ID for the single Pro tier. The current
 * product has per-tier price keys, but a few older server-side gates still
 * test the legacy variable directly. Until those large action modules can be
 * migrated independently, installLegacyBillingGateCompatibility makes those
 * boolean checks observe the modern configuration without ever turning a
 * modern tier price into the legacy Pro price.
 */

export const BILLING_CONFIG_SENTINEL = "__aria_modern_billing_configured__";

type BillingEnv = Record<string, string | undefined>;

function value(env: BillingEnv, key: string): string | null {
  const raw = env[key];
  return raw && raw.trim() ? raw.trim() : null;
}

export function hasModernPrice(env: BillingEnv = process.env): boolean {
  return !!(
    value(env, "STRIPE_PRICE_ID_PRO") ||
    value(env, "STRIPE_PRICE_ID_PRO_PLUS") ||
    value(env, "STRIPE_PRICE_ID_TEAM")
  );
}

export function legacyProPriceId(env: BillingEnv = process.env): string | null {
  const legacy = value(env, "STRIPE_PRICE_ID");
  return legacy && legacy !== BILLING_CONFIG_SENTINEL ? legacy : null;
}

export function billingConfigured(env: BillingEnv = process.env): boolean {
  const hasSecret = !!value(env, "STRIPE_SECRET_KEY");
  const hasPrice = hasModernPrice(env) || legacyProPriceId(env) !== null;
  return hasSecret && hasPrice;
}

/**
 * Compatibility bridge for legacy boolean gates that still read
 * process.env.STRIPE_PRICE_ID directly. A sentinel is used instead of copying
 * a real tier price, so price resolution can never mistake a Team/Pro+ price
 * for the legacy Pro price.
 */
export function installLegacyBillingGateCompatibility(
  env: BillingEnv = process.env,
): void {
  if (legacyProPriceId(env) !== null || !hasModernPrice(env)) return;
  try {
    env.STRIPE_PRICE_ID = BILLING_CONFIG_SENTINEL;
  } catch {
    // Some runtimes may expose an immutable env object. Callers that use the
    // shared billingConfigured() predicate remain correct even in that case.
  }
}
