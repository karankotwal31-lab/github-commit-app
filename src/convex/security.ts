import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/** Security and reliability primitives shared by backend features. */
export const RATE_WINDOW_MS = 60_000;
export const AI_REQUESTS_PER_MINUTE = 15;
export const GITHUB_ACTIONS_PER_MINUTE = 120;
export const OTP_SENDS_PER_5_MINUTES = 3;
export const GITHUB_CALLBACK_PER_MINUTE = 20;

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
      await ctx.db.insert("rateLimits", { bucket, windowStart: now, count: 1 });
      return true;
    }
    if (now - existing.windowStart >= windowMs) {
      await ctx.db.replace(existing._id, { bucket, windowStart: now, count: 1 });
      return true;
    }
    const allowed = existing.count < limit;
    await ctx.db.patch(existing._id, { count: existing.count + 1 });
    return allowed;
  } catch {
    // Availability is preferred if the limiter store itself is unhealthy.
    // The failure is transient and other auth/authorization checks still run.
    return true;
  }
}

export const bumpRateLimit = internalMutation({
  args: { bucket: v.string(), limit: v.number() },
  handler: async (ctx, args) => checkRateLimit(ctx, args.bucket, args.limit),
});

export const pruneRateLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    const rows = await ctx.db.query("rateLimits").collect();
    for (const row of rows) {
      if (row.windowStart < cutoff) await ctx.db.delete(row._id);
    }
  },
});

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

export const getFeatureFlags = query({
  args: {},
  handler: async (ctx): Promise<Record<FeatureFlagKey, boolean>> => {
    const rows = await ctx.db.query("featureFlags").collect();
    const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
    return {
      aiBackgroundChecker:
        byKey.get(FEATURE_FLAGS.AI_BACKGROUND_CHECKER) ?? true,
      liveCollaboration: byKey.get(FEATURE_FLAGS.LIVE_COLLABORATION) ?? true,
      crossRepoEdits: byKey.get(FEATURE_FLAGS.CROSS_REPO_EDITS) ?? true,
    };
  },
});

/**
 * Global operational controls are deployment-wide. A paid customer tier must
 * never grant access to them; only the explicit platform-admin role may read
 * operational logs or change global kill switches.
 */
async function isPlatformAdmin(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return false;
  const user = await ctx.db.get(userId);
  return user?.role === "admin";
}

export const setFeatureFlag = mutation({
  args: { key: FEATURE_FLAG_VALUES, enabled: v.boolean() },
  handler: async (ctx, args) => {
    if (!(await isPlatformAdmin(ctx))) {
      throw new Error("Only platform admins can change global feature switches.");
    }
    const userId = await getAuthUserId(ctx);
    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const doc = {
      key: args.key,
      enabled: args.enabled,
      updatedBy: userId ?? undefined,
      updatedAt: Date.now(),
    };
    if (existing !== null) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("featureFlags", doc);
    return { key: args.key, enabled: args.enabled };
  },
});

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
    const rows = await ctx.db.query("errorLogs").collect();
    if (rows.length > 500) {
      const toDelete = rows
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, rows.length - 500);
      for (const row of toDelete) await ctx.db.delete(row._id);
    }
    try {
      await ctx.scheduler.runAfter(0, internal.errorReporting.report, {
        source: args.source.slice(0, 100),
        message: args.message.slice(0, 2000),
        userId: args.userId,
        detail: args.detail ? args.detail.slice(0, 2000) : undefined,
      });
    } catch {
      // External reporting is best-effort and must never block app logic.
    }
  },
});

export const healthRecord = internalMutation({
  args: {
    check: v.union(
      v.literal("auth"),
      v.literal("otp"),
      v.literal("github"),
      v.literal("ai"),
      v.literal("email"),
      v.literal("airbrake"),
      v.literal("posthog"),
    ),
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
    const rows = await ctx.db.query("healthChecks").collect();
    if (rows.length > 2000) {
      const toDelete = rows
        .sort((a, b) => a.checkedAt - b.checkedAt)
        .slice(0, rows.length - 2000);
      for (const row of toDelete) await ctx.db.delete(row._id);
    }
  },
});

export const recentErrors = query({
  args: {},
  handler: async (ctx) => {
    if (!(await isPlatformAdmin(ctx))) return { authorized: false as const };
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
