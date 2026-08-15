import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import {
  checkRateLimit,
  OTP_SENDS_PER_5_MINUTES,
} from "../security";
import type { MutationCtx } from "../_generated/server";

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
  async sendVerificationRequest(
    { identifier: email, token }: { identifier: string; token: string },
    ctx?: { db: unknown },
  ) {
    if (ctx && typeof ctx.db === "object" && ctx.db !== null) {
      try {
        const allowed = await checkRateLimit(
          ctx as unknown as MutationCtx,
          `otp:${email.trim().toLowerCase().slice(0, 254)}`,
          OTP_SENDS_PER_5_MINUTES,
          OTP_WINDOW_MS,
        );
        if (!allowed) {
          throw new Error(
            "Too many sign-in codes requested for this address — wait a few minutes and try again.",
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Too many sign-in codes")) {
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
