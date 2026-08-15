import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { type PlanId } from "../lib/plans";

/**
 * Security & reliability core — shared by every Part D feature:
 *
 *  - Rate limits: fixed one-minute window counters in `rateLimits`, keyed by
 *    bucket ("ai:<user>", "github:<user>", "otp:<email>", "ghcallback:<ip>").
 *    Soft enforcement: a limiter hiccup never blocks a request.
 *  - Feature switches: global kill switches in `featureFlags` (absent row =
 *    enabled). Enforcement is server-side, at the action/mutation/cron layer.
 *  - Error log: server-side failures worth reviewing in `errorLogs`, surfaced
 *    in the admin console. A log entry still needs a human to read it.
 *  - Admin gating: feature switches, health results and error logs are
 *    admin-only (role "admin", or a Team/Enterprise plan — mirroring the
 *    existing admin-console authorization model).
 */

export const RATE_WINDOW_MS = 60_000;

/** User-facing rate limit budget defaults (per minute, per bucket). */
export const AI_REQUESTS_PER_MINUTE = 15;
export const GITHUB_ACTIONS_PER_MINUTE = 120;
export const OTP_SENDS_PER_5_MINUTES = 3;
export const GITHUB_CALLBACK_PER_MINUTE = 20;

/** The feature-switch keys used across the backend. */
export const FEATURE_FLAGS = {
  AI_BACKGROUND_CHECKER: "aiBackgroundChecker",
  LIVE_COLLABORATION: "liveCollaboration",
  CROSS_REPO_EDITS: "crossRepoEdits",
} as const;
export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

const FEATURE_FLAG_VALUES = v.union(
  v.literal(FEATURE_FLAGS.AI_BACKGROUND_CHECKER),
  v.literal(FEATURE_FLAGS.LIVE_COLLABORATION),
  v.literal(FEATURE_FLAGS.CROSS_REPO_EDITS),
);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Check + increment a fixed-window rate-limit bucket. Returns true when the
 * call is allowed. Increments on every check (blocked attempts count too).
 * Never throws — rate limiting is soft.
 */
export async function checkRateLimit(
  ctx: MutationCtx,
  bucket: string,
  limit: number,
  windowMs: number = RATE_WINDOW_MS,
): Promise<boolean> {
  try {
    const now = Date.now();
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_bucket", (q) => q.eq("bucket", bucket))
      .unique();
    if (existing === null) {
      await ctx.db.insert("rateLimits", {
        bucket,
        windowStart: now,
        count: 1,
      });
      return true;
    }
    if (now - existing.windowStart >= windowMs) {
      await ctx.db.replace(existing._id, {
        bucket,
        windowStart: now,
        count: 1,
      });
      return true;
    }
    const allowed = existing.count < limit;
    await ctx.db.patch(existing._id, { count: existing.count + 1 });
    return allowed;
  } catch {
    return true; // a limiter failure must never take the app down
  }
}

/** Internal: rate-limit check for actions (they must go through runMutation). */
export const bumpRateLimit = internalMutation({
  args: { bucket: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    return checkRateLimit(ctx, args.bucket, args.limit);
  },
});

/** Internal: prune rate-limit rows whose window has fully elapsed. */
export const pruneRateLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Rows are keyed per bucket and replaced on each window, so pruning only
    // needs to drop rows from windows long past — cover the longest window
    // (the 5-minute OTP throttle) plus slack.
    const cutoff = Date.now() - 10 * 60 * 1000;
    const rows = await ctx.db
      .query("rateLimits")
      .withIndex("by_bucket", (q) => q.gte("bucket", ""))
      .collect();
    for (const row of rows) {
      if (row.windowStart < cutoff) await ctx.db.delete(row._id);
    }
  },
});

// ---------------------------------------------------------------------------
// Feature switches (kill switches)
// ---------------------------------------------------------------------------

/** Internal: is a flag enabled? Absent row (fresh deployment) = enabled. */
export const featureFlag = internalQuery({
  args: { key: FEATURE_FLAG_VALUES },
  handler: async (ctx, args): Promise<boolean> => {
    const row = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return row === null ? true : row.enabled;
  },
});

/** Public snapshot of every flag (UI mirrors; enforcement is server-side). */
export const getFeatureFlags = query({
  args: {},
  handler: async (ctx): Promise<Record<FeatureFlagKey, boolean>> => {
    const rows = await ctx.db.query("featureFlags").collect();
    const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
    return {
      aiBackgroundChecker: byKey.get(FEATURE_FLAGS.AI_BACKGROUND_CHECKER) ?? true,
      liveCollaboration: byKey.get(FEATURE_FLAGS.LIVE_COLLABORATION) ?? true,
      crossRepoEdits: byKey.get(FEATURE_FLAGS.CROSS_REPO_EDITS) ?? true,
    };
  },
});

/**
 * Admin gate for feature switches: the built-in "admin" role, or a
 * Team/Enterprise plan (the same authorization model as the admin console).
 */
async function isAdminUser(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return false;
  const user = await ctx.db.get(userId);
  if (user?.role === "admin") return true;
  const billingRow = await ctx.db
    .query("billing")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  const plan: PlanId = (billingRow?.plan ?? "free") as PlanId;
  return plan === "team" || plan === "enterprise";
}

/** Flip a feature switch. Admin-only; takes effect server-side immediately. */
export const setFeatureFlag = mutation({
  args: { key: FEATURE_FLAG_VALUES, enabled: v.boolean() },
  handler: async (ctx, args) => {
    if (!(await isAdminUser(ctx))) {
      throw new Error("Only workspace admins can change feature switches.");
    }
    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const doc = {
      key: args.key,
      enabled: args.enabled,
      updatedBy: (await getAuthUserId(ctx)) ?? undefined,
      updatedAt: Date.now(),
    };
    if (existing !== null) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("featureFlags", doc);
    }
    return { key: args.key, enabled: args.enabled };
  },
});

// ---------------------------------------------------------------------------
// Error log
// ---------------------------------------------------------------------------

/** Internal: record a server-side failure for review. Capped to the latest. */
export const logError = internalMutation({
  args: {
    source: v.string(),
    message: v.string(),
    userId: v.optional(v.id("users")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("errorLogs", {
      source: args.source.slice(0, 60),
      message: args.message.slice(0, 500),
      userId: args.userId,
      detail: args.detail ? args.detail.slice(0, 2000) : undefined,
      createdAt: Date.now(),
    });
    // Keep the log bounded (a runaway loop shouldn't grow it forever).
    const rows = await ctx.db.query("errorLogs").collect();
    if (rows.length > 500) {
      const toDelete = rows
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, rows.length - 500);
      for (const row of toDelete) await ctx.db.delete(row._id);
    }
  },
});

/** Internal: record one health-check probe result (written by the cron). */
export const healthRecord = internalMutation({
  args: {
    check: v.union(v.literal("auth"), v.literal("github"), v.literal("ai")),
    ok: v.boolean(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("healthChecks", {
      check: args.check,
      ok: args.ok,
      detail: args.detail ? args.detail.slice(0, 500) : undefined,
      checkedAt: Date.now(),
    });
    // Keep only the most recent probes per check (the query reads latest-per-
    // check, so old rows are just history).
    const rows = await ctx.db.query("healthChecks").collect();
    if (rows.length > 2000) {
      const toDelete = rows
        .sort((a, b) => a.checkedAt - b.checkedAt)
        .slice(0, rows.length - 2000);
      for (const row of toDelete) await ctx.db.delete(row._id);
    }
  },
});

/** Admin-only: the latest error log entries. */
export const recentErrors = query({
  args: {},
  handler: async (ctx) => {
    if (!(await isAdminUser(ctx))) return { authorized: false as const };
    const rows = await ctx.db
      .query("errorLogs")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", 0))
      .collect();
    return {
      authorized: true as const,
      errors: rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50)
        .map((r) => ({
          source: r.source,
          message: r.message,
          detail: r.detail ?? null,
          createdAt: r.createdAt,
        })),
    };
  },
});
