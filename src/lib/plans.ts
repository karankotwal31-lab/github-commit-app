/**
 * Aria's plan ladder — the single source of truth for tier metadata.
 *
 * Shared by the Convex backend (quota enforcement, Stripe price mapping) and
 * the frontend (pricing table, usage meter). Pure data: never read env vars
 * here — price IDs live in billing.ts/billingActions.ts via STRIPE_PRICE_ID_*.
 *
 * Pricing is set against the 2026 market for AI coding tools:
 *   - Copilot Pro $10/mo (300 premium reqs)  ·  Cursor Pro $20/mo (500 fast reqs)
 *   - Copilot Pro+ $39/mo (1,500 reqs)       ·  Windsurf Pro $15/mo
 *   - Copilot Enterprise $39/seat  ·  Cursor Business $40/seat (SSO + admin)
 * Aria undercuts the comparable tier at every rung and keeps the same
 * request-quota pattern users already understand.
 */

export const PLAN_IDS = [
  "free",
  "pro",
  "pro_plus",
  "team",
  "enterprise",
] as const;

export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  /** Display price, e.g. "$0", "$12", "$45/seat". */
  priceLabel: string;
  /** Numeric price for sorting/display; undefined for Custom. */
  monthlyPrice?: number;
  /** Ask Aria requests per calendar month; null = unlimited (fair use). */
  aiQuota: number | null;
  tagline: string;
  features: string[];
  /** Tiers you can buy at checkout (free/enterprise have no checkout). */
  checkout: boolean;
  highlighted?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    priceLabel: "$0",
    monthlyPrice: 0,
    aiQuota: 50,
    tagline: "For a first look — everything core, plus a taste of Aria AI.",
    features: [
      "Browse, edit, stage & commit to any public repo",
      "Branches, pull requests, merge & revert",
      "CI status, code search, issues",
      "Draft vault + cross-device continuity",
      "Live presence + offline draft sync",
      "50 Ask Aria requests / month",
    ],
    checkout: false,
  },
  {
    id: "pro",
    name: "Pro",
    priceLabel: "$12",
    monthlyPrice: 12,
    aiQuota: 300,
    tagline: "For daily work — unlimited private repos and a real AI quota.",
    features: [
      "Everything in Free",
      "Unlimited private repositories",
      "Unified cross-repo inbox (PRs, issues, CI)",
      "300 Ask Aria requests / month",
      "Priority model access as new models ship",
    ],
    checkout: true,
    highlighted: true,
  },
  {
    id: "pro_plus",
    name: "Pro+",
    priceLabel: "$29",
    monthlyPrice: 29,
    aiQuota: 1500,
    tagline: "For heavy AI users — 5× the quota and AI reviews on every push.",
    features: [
      "Everything in Pro",
      "1,500 Ask Aria requests / month",
      "AI PR descriptions with risk flags",
      "AI review pass before every push",
      "Best available model access",
    ],
    checkout: true,
  },
  {
    id: "team",
    name: "Team",
    priceLabel: "$45/seat",
    monthlyPrice: 45,
    aiQuota: null,
    tagline: "For organizations — unlimited AI with governance and audit.",
    features: [
      "Everything in Pro+",
      "Unlimited Ask Aria (org-wide policy)",
      "SSO / SAML sign-in",
      "Audit logs — who did what, when",
      "Admin console: seats, roles, usage analytics",
      "Billed per seat, prorated add/remove",
    ],
    checkout: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceLabel: "Custom",
    aiQuota: null,
    tagline: "For scale — self-hosted options, custom SLA, volume pricing.",
    features: [
      "Everything in Team",
      "Self-hosted / private deployment",
      "Custom SLA + onboarding",
      "Volume discounts",
    ],
    checkout: false,
  },
];

export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p]),
) as Record<PlanId, Plan>;

/** The Ask Aria request quota for a plan (null = unlimited). */
export function aiQuotaFor(plan: PlanId): number | null {
  return PLAN_BY_ID[plan]?.aiQuota ?? null;
}

/** Calendar-month period key, e.g. "2026-08". Matches the metering table. */
export function periodKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
