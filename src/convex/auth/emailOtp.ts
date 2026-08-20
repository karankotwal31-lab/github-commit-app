import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import {
  checkRateLimit,
  OTP_SENDS_PER_5_MINUTES,
} from "../security";
import {
  isEmailLockedOut,
  recordFailedAttempt,
  clearLockout,
} from "../securityHardening";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

// Max OTP emails per address per window (Part D). Kept deliberately small:
// the verification side already locks out after too many failed attempts
// (Convex Auth's built-in authRateLimits), so this throttles the send side.
const OTP_WINDOW_MS = 5 * 60 * 1000;

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  // The Convex Auth runtime passes the mutation context as the second
  // argument (see signInViaProvider) — used here to throttle OTP sends.
  // Part E: also checks account lockout and records login activity.
  async sendVerificationRequest(
    { identifier: email, token }: { identifier: string; token: string },
    ctx?: { db: unknown },
  ) {
    if (ctx && typeof ctx.db === "object" && ctx.db !== null) {
      const mCtx = ctx as unknown as MutationCtx;

      // Part E: check account lockout before sending.
      try {
        const locked = await isEmailLockedOut(mCtx, email);
        if (locked) {
          // Record the locked-out attempt.
          await mCtx.runMutation(
            internal.securityHardening.recordLoginAttempt,
            {
              email,
              result: "locked_out",
              detail: "Account locked after too many failed attempts.",
            },
          );
          throw new Error(
            "This account is temporarily locked due to too many failed sign-in attempts. Please wait 15 minutes and try again.",
          );
        }
      } catch (e) {
        if (
          e instanceof Error &&
          e.message.startsWith("This account is temporarily locked")
        ) {
          throw e;
        }
        // A lockout check failure must never block sign-in.
      }

      // Part D: rate limit OTP sends.
      try {
        const allowed = await checkRateLimit(
          mCtx,
          `otp:${email.trim().toLowerCase().slice(0, 254)}`,
          OTP_SENDS_PER_5_MINUTES,
          OTP_WINDOW_MS,
        );
        if (!allowed) {
          // Part E: record rate-limited attempt.
          await mCtx.runMutation(
            internal.securityHardening.recordLoginAttempt,
            {
              email,
              result: "rate_limited",
              detail: "Too many OTP requests.",
            },
          );
          throw new Error(
            "Too many sign-in codes requested for this address — wait a few minutes and try again.",
          );
        }
      } catch (e) {
        if (
          e instanceof Error &&
          (e.message.startsWith("Too many sign-in codes") ||
            e.message.startsWith("This account is temporarily locked"))
        ) {
          throw e;
        }
        // A limiter failure must never block sign-in.
      }
    }
    try {
      await axios.post(
        "https://auth.freebuff.app/send_otp",
        {
          to: email,
          otp: token,
          appName: process.env.VLY_APP_NAME || "a freebuff.com application",
        },
        {
          headers: {
            "x-api-key": "fb_email_2crN1hqIArZP2bEfvjp5Qik4",
          },
        },
      );
    } catch (error) {
      throw new Error(JSON.stringify(error));
    }
  },
});

// ---------------------------------------------------------------------------
// Post-verification hooks
// ---------------------------------------------------------------------------

/**
 * Called after a successful OTP verification to clear lockout state and
 * record the successful login. Exported as a named const so the auth
 * flow can call it, or it can be wired via the Convex Auth callback.
 */
export async function onOtpVerified(
  ctx: MutationCtx,
  email: string,
  userId: string,
  ip?: string,
  userAgent?: string,
) {
  await clearLockout(ctx, email);
  await ctx.runMutation(internal.securityHardening.recordLoginAttempt, {
    userId: userId as never,
    email,
    result: "success",
    ip,
    userAgent,
  });
}

/**
 * Called after a failed OTP verification to record the failure and
 * increment the lockout counter.
 */
export async function onOtpFailed(
  ctx: MutationCtx,
  email: string,
  ip?: string,
  userAgent?: string,
) {
  const { locked, remaining } = await recordFailedAttempt(ctx, email);
  await ctx.runMutation(internal.securityHardening.recordLoginAttempt, {
    email,
    result: locked ? "locked_out" : "failed_otp",
    ip,
    userAgent,
    detail: locked
      ? "Account locked after too many failed attempts."
      : `${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
  });
  if (locked) {
    // Record a security event notification for the user (best-effort).
    try {
      // Look up user by email to record the event.
      const user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .unique();
      if (user) {
        await ctx.runMutation(
          internal.securityHardening.recordSecurityEvent,
          {
            userId: user._id,
            kind: "lockout",
            title: "Account temporarily locked",
            detail:
              "Too many failed sign-in attempts. Your account is locked for 15 minutes.",
          },
        );
      }
    } catch {
      // best effort
    }
  }
}
