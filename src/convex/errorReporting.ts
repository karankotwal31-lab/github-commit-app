import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { fetchWithRetry } from "./net";

/**
 * External error monitoring (Airbrake) — fail-open.
 *
 * Hooks into the existing error log: every `security.logError` entry (cron
 * per-user failures, health probe failures, provider hiccups) is also
 * reported to Airbrake via the notifier API, fire-and-forget. Reporting never
 * blocks the error log and never throws into the caller.
 *
 * Env vars (project keys): AIRBRAKE_PROJECT_ID (numeric project id) and
 * AIRBRAKE_API_KEY (project key). Without them everything is a no-op and the
 * app keeps its own Convex error log as before.
 */

function airbrakeConfigured(): boolean {
  return !!(
    process.env.AIRBRAKE_PROJECT_ID && process.env.AIRBRAKE_API_KEY
  );
}

/** Report one error to Airbrake (v4 notifier API). Never throws. */
export const report = internalAction({
  args: {
    source: v.string(),
    message: v.string(),
    userId: v.optional(v.id("users")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ reported: boolean; status?: number }> => {
    if (!airbrakeConfigured()) return { reported: false };
    const projectId = process.env.AIRBRAKE_PROJECT_ID as string;
    const apiKey = process.env.AIRBRAKE_API_KEY as string;
    try {
      const res = await fetchWithRetry(
        `https://api.airbrake.io/api/v4/projects/${encodeURIComponent(
          projectId,
        )}/notices`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            notifier: {
              name: "Aria",
              version: "1.0.0",
              url: "https://arialabs.dev",
            },
            errors: [
              {
                type: "ConvexError",
                message: `${args.source}: ${args.message}`.slice(0, 2000),
              },
            ],
            context: {
              environment: process.env.VLY_APP_NAME
                ? "preview"
                : "production",
              component: args.source.slice(0, 100),
            },
            params: {
              userId: args.userId ?? null,
              detail: args.detail ? args.detail.slice(0, 2000) : null,
            },
          }),
        },
        { attempts: 2 },
      );
      return { reported: res.ok, status: res.status };
    } catch {
      return { reported: false };
    }
  },
});
