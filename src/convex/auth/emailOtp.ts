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

// Max OTP emails per address per window. Kept deliberately small: the
// verification side already locks out after repeated failures, so this
// throttles the send side as well.
const OTP_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_OTP_RELAY_URL = "https://auth.freebuff.app/send_otp";

function otpRelayConfig(): { url: string; apiKey: string } {
  const apiKey = process.env.FREEBUFF_EMAIL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Email sign-in is not configured. Set FREEBUFF_EMAIL_API_KEY in the Convex deployment environment.",
    );
  }

  const rawUrl = process.env.FREEBUFF_EMAIL_API_URL?.trim() || DEFAULT_OTP_RELAY_URL;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Email sign-in relay URL is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Email sign-in relay URL must use HTTPS.");
  }
  return { url: url.toString(), apiKey };
}

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  // Convex Auth passes the mutation context as the second argument. Use it to
  // enforce the same lockout/rate-limit policy before an email is sent.
  async sendVerificationRequest(
    { identifier: email, token }: { identifier: string; token: string },
    ctx?: { db: unknown },
  ) {
    if (ctx && typeof ctx.db === "object" && ctx.db !== null) {
      const mCtx = ctx as unknown as MutationCtx;

      try {
        const locked = await isEmailLockedOut(mCtx, email);
        if (locked) {
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
        // A lockout-store failure must not turn into an auth outage.
      }

      try {
        const allowed = await checkRateLimit(
          mCtx,
          `otp:${email.trim().toLowerCase().slice(0, 254)}`,
          OTP_SENDS_PER_5_MINUTES,
          OTP_WINDOW_MS,
        );
        if (!allowed) {
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
        // A limiter-store failure must not turn into an auth outage.
      }
    }

    const relay = otpRelayConfig();
    try {
      await axios.post(
        relay.url,
        {
          to: email,
          otp: token,
          appName: process.env.VLY_APP_NAME || "Aria",
        },
        {
          headers: {
            "x-api-key": relay.apiKey,
            "Content-Type": "application/json",
          },
          timeout: 10_000,
          maxRedirects: 0,
        },
      );
    } catch (error) {
      // Never stringify Axios errors: their request config may contain the API
      // key. Return a stable user-safe message and keep secrets out of logs/UI.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      throw new Error(
        status
          ? `Unable to send the sign-in code (email service returned ${status}).`
          : "Unable to send the sign-in code. Please try again.",
      );
    }
  },
});

/** Clear lockout state and record a successful OTP verification. */
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

/** Record a failed OTP verification and increment the lockout counter. */
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
    try {
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
      // Security-event recording is best-effort and must not affect auth.
    }
  }
}
