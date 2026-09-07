import { describe, expect, test } from "bun:test";
import {
  BILLING_CONFIG_SENTINEL,
  billingConfigured,
  hasModernPrice,
  installLegacyBillingGateCompatibility,
  legacyProPriceId,
} from "./billingConfig";

describe("billing configuration", () => {
  test("modern tier prices enable billing with a Stripe secret", () => {
    const env = {
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_PRICE_ID_PRO_PLUS: "price_pro_plus",
    };
    expect(hasModernPrice(env)).toBe(true);
    expect(billingConfigured(env)).toBe(true);
  });

  test("a price without the Stripe secret does not enable billing", () => {
    expect(billingConfigured({ STRIPE_PRICE_ID_PRO: "price_pro" })).toBe(false);
  });

  test("legacy Pro price remains supported", () => {
    const env = {
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_PRICE_ID: "price_legacy_pro",
    };
    expect(legacyProPriceId(env)).toBe("price_legacy_pro");
    expect(billingConfigured(env)).toBe(true);
  });

  test("compatibility sentinel makes legacy boolean gates truthy without becoming a price", () => {
    const env: Record<string, string | undefined> = {
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_PRICE_ID_TEAM: "price_team",
    };
    installLegacyBillingGateCompatibility(env);
    expect(env.STRIPE_PRICE_ID).toBe(BILLING_CONFIG_SENTINEL);
    expect(legacyProPriceId(env)).toBeNull();
    expect(billingConfigured(env)).toBe(true);
  });

  test("a real legacy Pro price is never overwritten", () => {
    const env: Record<string, string | undefined> = {
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_PRICE_ID: "price_legacy_pro",
      STRIPE_PRICE_ID_TEAM: "price_team",
    };
    installLegacyBillingGateCompatibility(env);
    expect(env.STRIPE_PRICE_ID).toBe("price_legacy_pro");
  });
});
