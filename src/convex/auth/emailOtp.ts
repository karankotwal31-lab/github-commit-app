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
  // The Convex Auth runtime supplies the full provider request and an
  // auth-aware action context.  Leaving the parameters contextually typed is
  // important: the provider also supplies the verification URL and expiry.
  async sendVerificationRequest(
    { identifier: email, token }: VerificationRequest,
    ctx?: GenericActionCtxWithAuthConfig<DataModel>,
  ) {
    const key = process.env.OTP_EMAIL_API_KEY;
    if (!key) throw new Error("Email sign-in is not configured. Contact the administrator.");
    if (ctx) {
      const allowed = await ctx.runMutation(internal.securityHardening.reserveOtpSend, { email });
      if (!allowed) throw new Error("Too many sign-in requests. Please wait before trying again.");
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
            "x-api-key": key,
          },
        },
      );
    } catch {
      throw new Error("The sign-in email could not be sent. Please try again later.");
    }
  },
});
