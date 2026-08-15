import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalAction,
  query,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { fetchWithRetry } from "./net";

/**
 * Server-side product analytics (PostHog) — fire-and-forget, fail-open.
 *
 * Events are captured from Convex actions/mutations (never from the client),
 * so no tracking script ships in the bundle and the project key never touches
 * the browser. Every call is best-effort: no key configured → no-op; a slow
 * or failing PostHog API never blocks or breaks the feature it instruments.
 *
 * Env vars (project keys): POSTHOG_API_KEY (PostHog project API key, phc_…).
 * Optional: POSTHOG_API_HOST (defaults to https://us.i.posthog.com; set
 * https://eu.i.posthog.com for EU data residency).
 */

const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

export function posthogConfigured(): boolean {
  return !!process.env.POSTHOG_API_KEY;
}

export type AnalyticsProperties = Record<
  string,
  string | number | boolean | null
>;

/** Send one capture request to PostHog. Never throws. */
export const capture = internalAction({
  args: {
    event: v.string(),
    distinctId: v.string(),
    properties: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null()),
      ),
    ),
  },
  handler: async (ctx, args): Promise<{ captured: boolean; status?: number }> => {
    if (!posthogConfigured()) return { captured: false };
    const host = process.env.POSTHOG_API_HOST ?? POSTHOG_DEFAULT_HOST;
    try {
      const res = await fetchWithRetry(
        `${host}/capture`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: process.env.POSTHOG_API_KEY,
            event: args.event.slice(0, 200),
            distinct_id: args.distinctId.slice(0, 200),
            properties: {
              ...(args.properties ?? {}),
              app: "aria",
              source: "server",
            },
          }),
        },
        { attempts: 2 },
      );
      return { captured: res.ok, status: res.status };
    } catch {
      return { captured: false };
    }
  },
});

/**
 * Wrapper for callers inside actions: captures one event without ever
 * interrupting the surrounding flow.
 */
export async function captureEvent(
  ctx: ActionCtx,
  event: string,
  distinctId: string,
  properties?: AnalyticsProperties,
): Promise<void> {
  try {
    await ctx.runAction(internal.analytics.capture, {
      event,
      distinctId,
      properties,
    });
  } catch {
    // Analytics is best-effort — a failure here must never fail the caller.
  }
}

/** Signed-in user's view of which optional integrations are configured. */
export const integrationStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { signedIn: false as const };
    return {
      signedIn: true as const,
      email: !!process.env.RESEND_API_KEY,
      airbrake: !!(
        process.env.AIRBRAKE_PROJECT_ID && process.env.AIRBRAKE_API_KEY
      ),
      posthog: posthogConfigured(),
    };
  },
});
