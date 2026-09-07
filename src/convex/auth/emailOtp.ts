import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import type { GenericActionCtxWithAuthConfig } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

type VerificationRequest = {
  identifier: string;
  token: string;
  url: string;
  expires: Date;
  provider: unknown;
  request: Request;
  theme: unknown;
};
// Sending is throttled atomically by reserveOtpSend before calling the relay.
const DEFAULT_OTP_RELAY_URL = "https://auth.freebuff.app/send_otp";

function otpRelayConfig(): { url: string; apiKey: string } {
  const apiKey = (process.env.FREEBUFF_EMAIL_API_KEY || process.env.OTP_EMAIL_API_KEY)?.trim();
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
  // The Convex Auth runtime supplies the full provider request and an
  // auth-aware action context.  Leaving the parameters contextually typed is
  // important: the provider also supplies the verification URL and expiry.
  async sendVerificationRequest(
    { identifier: email, token }: VerificationRequest,
    ctx?: GenericActionCtxWithAuthConfig<DataModel>,
  ) {
    if (ctx) {
      const allowed = await ctx.runMutation(internal.securityHardening.reserveOtpSend, { email });
      if (!allowed) throw new Error("Too many sign-in requests. Please wait before trying again.");
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
    } catch {
      throw new Error("The sign-in email could not be sent. Please try again later.");
    }
  },
});
