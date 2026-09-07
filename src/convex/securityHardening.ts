import { checkRateLimit, OTP_SENDS_PER_5_MINUTES } from "./security";
/**
 * Security Hardening — Part E.
 *
 * Login activity tracking, account lockout after brute-force, session
 * management (active devices + sign-out-everywhere), email verification
 * status, and security event notifications. All enforcement is server-side;
 * the UI only mirrors what the backend stores.
 */

import { getAuthUserId, getAuthSessionId, invalidateSessions } from "@convex-dev/auth/server";
import {
  action,
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { cleanText, cleanName } from "../lib/sanitize";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max failed OTP attempts before lockout. */
export const MAX_FAILED_ATTEMPTS = 5;
/** How long the account stays locked (ms). */
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
/** How long the failure window is before the counter resets (ms). */
export const FAILURE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
/** Max login activity rows kept per user. */
const MAX_LOGIN_ACTIVITY = 100;
/** Max security event rows kept per user. */
const MAX_SECURITY_EVENTS = 50;

// ---------------------------------------------------------------------------
// Lockout helpers (used by emailOtp.ts)
// ---------------------------------------------------------------------------

/**
 * Check whether an email is currently locked out. Returns true when the
 * account is locked (too many failed attempts within the window).
 */
export async function isEmailLockedOut(
  ctx: MutationCtx,
  email: string,
): Promise<boolean> {
  try {
    const normalized = email.trim().toLowerCase().slice(0, 254);
    const row = await ctx.db
      .query("accountLockouts")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();
    if (!row) return false;
    // If there's a lock and it hasn't expired, it's locked.
    if (row.lockedUntil && row.lockedUntil > Date.now()) return true;
    // If the window has expired, the row is stale — clean it up silently.
    if (Date.now() - row.windowStart > FAILURE_WINDOW_MS) {
      await ctx.db.delete(row._id);
      return false;
    }
    return false;
  } catch {
    return false; // lockout failure must never block sign-in
  }
}

/**
 * Record a failed OTP attempt. After MAX_FAILED_ATTEMPTS, locks the account.
 * Called from the OTP verification failure path.
 */
export async function recordFailedAttempt(
  ctx: MutationCtx,
  email: string,
): Promise<{ locked: boolean; remaining: number }> {
  try {
    const normalized = email.trim().toLowerCase().slice(0, 254);
    const now = Date.now();
    const existing = await ctx.db
      .query("accountLockouts")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();

    // If already locked, reject immediately.
    if (existing?.lockedUntil && existing.lockedUntil > now) {
      return { locked: true, remaining: 0 };
    }

    // Reset window if stale or first entry.
    const windowStart =
      existing && now - existing.windowStart < FAILURE_WINDOW_MS
        ? existing.windowStart
        : now;
    const count =
      existing && now - existing.windowStart < FAILURE_WINDOW_MS
        ? existing.failedAttempts + 1
        : 1;

    if (count >= MAX_FAILED_ATTEMPTS) {
      // Lock the account.
      if (existing) {
        await ctx.db.replace(existing._id, {
          email: normalized,
          failedAttempts: count,
          lockedUntil: now + LOCKOUT_DURATION_MS,
          windowStart,
        });
      } else {
        await ctx.db.insert("accountLockouts", {
          email: normalized,
          failedAttempts: count,
          lockedUntil: now + LOCKOUT_DURATION_MS,
          windowStart,
        });
      }
      return { locked: true, remaining: 0 };
    }

    // Not locked yet — just increment the counter.
    if (existing) {
      await ctx.db.replace(existing._id, {
        email: normalized,
        failedAttempts: count,
        lockedUntil: undefined,
        windowStart,
      });
    } else {
      await ctx.db.insert("accountLockouts", {
        email: normalized,
        failedAttempts: count,
        lockedUntil: undefined,
        windowStart,
      });
    }
    return { locked: false, remaining: MAX_FAILED_ATTEMPTS - count };
  } catch {
    // A lockout failure must never block sign-in.
    return { locked: false, remaining: MAX_FAILED_ATTEMPTS };
  }
}

/**
 * Clear lockout state after a successful sign-in.
 */
export async function clearLockout(
  ctx: MutationCtx,
  email: string,
): Promise<void> {
  try {
    const normalized = email.trim().toLowerCase().slice(0, 254);
    const row = await ctx.db
      .query("accountLockouts")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .unique();
    if (row) await ctx.db.delete(row._id);
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Login activity recording
// ---------------------------------------------------------------------------

/** Record a login attempt (success or failure). */
export const recordLoginAttempt = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    email: v.string(),
    result: v.union(
      v.literal("success"),
      v.literal("failed_otp"),
      v.literal("locked_out"),
      v.literal("rate_limited"),
    ),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("loginActivity", {
      userId: args.userId,
      email: cleanName(args.email, 254),
      result: args.result,
      ip: args.ip ? cleanText(args.ip, 45) : undefined,
      userAgent: args.userAgent ? cleanText(args.userAgent, 300) : undefined,
      detail: args.detail ? cleanText(args.detail, 200) : undefined,
      createdAt: now,
    });

    // Prune old entries for this email (keep newest 100).
    const rows = await ctx.db
      .query("loginActivity")
      .withIndex("by_email", (q) =>
        q.eq("email", cleanName(args.email, 254)),
      )
      .collect();
    if (rows.length > MAX_LOGIN_ACTIVITY) {
      const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      for (const old of sorted.slice(MAX_LOGIN_ACTIVITY)) {
        await ctx.db.delete(old._id);
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Session management (active devices via liveSessions)
// ---------------------------------------------------------------------------

/** List active sessions for the signed-in user (from liveSessions table). */
export const listSessions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const now = Date.now();
    const rows = await ctx.db
      .query("liveSessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    // Consider a session stale if not updated in 5 minutes.
    const STALE_MS = 5 * 60 * 1000;
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((r) => ({
        _id: r._id,
        deviceId: r.deviceId,
        label: r.label,
        repo: r.repo ?? null,
        branch: r.branch ?? null,
        path: r.path ?? null,
        lastSeen: r.updatedAt,
        active: now - r.updatedAt < STALE_MS,
      }));
  },
});

/** List login history for the signed-in user. */
export const listLoginHistory = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("loginActivity")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((r) => ({
        _id: r._id,
        email: r.email,
        result: r.result,
        ip: r.ip ?? null,
        userAgent: r.userAgent ?? null,
        detail: r.detail ?? null,
        createdAt: r.createdAt,
      }));
  },
});

/** Sign out all other sessions (delete all liveSessions except the current device). */
export const signOutAllSessions = action({
  args: { currentDeviceId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in.");
    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, { userId, except: sessionId ? [sessionId] : [] });
    return ctx.runMutation(internal.securityHardening.clearOtherPresence, { ...args, userId });
  },
});

export const clearOtherPresence = internalMutation({
  args: { currentDeviceId: v.optional(v.string()), userId: v.id("users") },
  handler: async (ctx, args) => {
    const userId = args.userId;
    if (!userId) throw new Error("Not signed in.");
    const rows = await ctx.db
      .query("liveSessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    let deleted = 0;
    for (const row of rows) {
      if (args.currentDeviceId && row.deviceId === args.currentDeviceId) continue;
      await ctx.db.delete(row._id);
      deleted++;
    }
    // Record a security event.
    const now = Date.now();
    const key = `sign_out_all:${now}`;
    await ctx.db.insert("securityEvents", {
      userId,
      key,
      kind: "sign_out_all",
      title: "Signed out all other sessions",
      detail: `Signed out ${deleted} other session${deleted === 1 ? "" : "s"}.`,
      sentAt: now,
    });
    return { deleted };
  },
});

// ---------------------------------------------------------------------------
// Email verification status
// ---------------------------------------------------------------------------

/** Get the email verification status for the signed-in user. */
export const emailVerificationStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      email: user.email ?? null,
      verified: !!user.emailVerificationTime,
      verifiedAt: user.emailVerificationTime ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// Security events (notifications)
// ---------------------------------------------------------------------------

/** Record a security event (new device, lockout, etc.). */
export const recordSecurityEvent = internalMutation({
  args: {
    userId: v.id("users"),
    kind: v.union(
      v.literal("new_device"),
      v.literal("lockout"),
      v.literal("sign_out_all"),
      v.literal("token_revoked"),
    ),
    title: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Dedup: don't record the same event kind within 60 seconds.
    const recent = await ctx.db
      .query("securityEvents")
      .withIndex("by_userKey", (q) =>
        q.eq("userId", args.userId).gte("key", `${args.kind}:`),
      )
      .collect();
    const isDuplicate = recent.some(
      (r) => r.kind === args.kind && now - r.sentAt < 60_000,
    );
    if (isDuplicate) return;

    const key = `${args.kind}:${now}`;
    await ctx.db.insert("securityEvents", {
      userId: args.userId,
      key,
      kind: args.kind,
      title: cleanText(args.title, 200),
      detail: cleanText(args.detail, 600),
      sentAt: now,
    });

    // Prune old events.
    const all = await ctx.db
      .query("securityEvents")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    if (all.length > MAX_SECURITY_EVENTS) {
      const sorted = [...all].sort((a, b) => b.sentAt - a.sentAt);
      for (const old of sorted.slice(MAX_SECURITY_EVENTS)) {
        await ctx.db.delete(old._id);
      }
    }
  },
});

/** List security events for the signed-in user. */
export const listSecurityEvents = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("securityEvents")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .sort((a, b) => b.sentAt - a.sentAt)
      .slice(0, 30)
      .map((r) => ({
        _id: r._id,
        kind: r.kind,
        title: r.title,
        detail: r.detail,
        sentAt: r.sentAt,
      }));
  },
});

// ---------------------------------------------------------------------------
// Account deletion (GDPR)
// ---------------------------------------------------------------------------

/** Request account data export summary. */
export const accountDataSummary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const loginCount = (
      await ctx.db
        .query("loginActivity")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect()
    ).length;
    const sessionCount = (
      await ctx.db
        .query("liveSessions")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect()
    ).length;
    const auditCount = (
      await ctx.db
        .query("auditLogs")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect()
    ).length;
    const repoCount = (
      await ctx.db
        .query("connectedRepos")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect()
    ).length;
    return { loginCount, sessionCount, auditCount, repoCount };
  },
});


export const reserveOtpSend = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.trim().toLowerCase();
    if (await isEmailLockedOut(ctx, normalized)) return false;
    return checkRateLimit(ctx, `otp:${normalized}`, OTP_SENDS_PER_5_MINUTES, 5 * 60 * 1000);
  },
});
export const reserveOtpAttempt = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (await isEmailLockedOut(ctx, email)) return false;
    await recordFailedAttempt(ctx, email);
    return true;
  },
});
export const completeOtpAttempt = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    await clearLockout(ctx, email);
    const user = await ctx.db.query("users").withIndex("email", q => q.eq("email", email.trim().toLowerCase())).first();
    await ctx.db.insert("loginActivity", { userId: user?._id, email: email.trim().toLowerCase(), result: "success", createdAt: Date.now() });
  },
});
