import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchWithRetry } from "./net";

/**
 * Health checks (Part D, step 7): a scheduled background probe that verifies
 * the three critical connections — login/auth, GitHub, and the AI provider —
 * and records the result in `healthChecks` so a human can review it in the
 * admin console.
 *
 * What's automatic vs. what still needs a human:
 *   - automatic: the probes run hourly (see crons.ts), results are stored,
 *     and failures are written to the error log.
 *   - still needs a human: reading the results/error log and acting on them.
 *     The checks never page anyone and never self-heal.
 */

const GITHUB_API = "https://api.github.com";

interface ProbeResult {
  check: "auth" | "github" | "ai";
  ok: boolean;
  detail?: string;
}

/** Login/auth probe: the deployment's OIDC discovery document must resolve. */
async function probeAuth(): Promise<ProbeResult> {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) {
    return {
      check: "auth",
      ok: true,
      detail: "CONVEX_SITE_URL not set here — auth is self-hosted, skipping.",
    };
  }
  try {
    const res = await fetchWithRetry(
      `${siteUrl}/.well-known/openid-configuration`,
      undefined,
      { attempts: 2 },
    );
    if (!res.ok) {
      return {
        check: "auth",
        ok: false,
        detail: `OIDC discovery returned HTTP ${res.status}.`,
      };
    }
    const body = (await res.json()) as { issuer?: string } | null;
    if (!body?.issuer) {
      return { check: "auth", ok: false, detail: "OIDC discovery missing issuer." };
    }
    return { check: "auth", ok: true, detail: `issuer: ${body.issuer}` };
  } catch (e) {
    return {
      check: "auth",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 300) : "auth probe failed",
    };
  }
}

/** GitHub probe: credentials configured + GitHub API reachable (public call). */
async function probeGithub(): Promise<ProbeResult> {
  const hasKeys = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  try {
    const res = await fetchWithRetry(
      `${GITHUB_API}/rate_limit`,
      undefined,
      { attempts: 2 },
    );
    if (!res.ok) {
      return {
        check: "github",
        ok: false,
        detail: `GitHub API returned HTTP ${res.status}.`,
      };
    }
    return {
      check: "github",
      ok: true,
      detail: hasKeys ? "GitHub OAuth keys configured; API reachable." : "API reachable; GitHub OAuth keys not configured.",
    };
  } catch (e) {
    return {
      check: "github",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 300) : "GitHub probe failed",
    };
  }
}

/** AI probe: provider key configured + OpenRouter API reachable. */
async function probeAi(): Promise<ProbeResult> {
  const hasKey = !!process.env.OPENROUTER_API_KEY;
  try {
    const res = await fetchWithRetry(
      "https://openrouter.ai/api/v1/models",
      hasKey
        ? { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } }
        : undefined,
      { attempts: 2 },
    );
    if (!res.ok) {
      return {
        check: "ai",
        ok: false,
        detail: `AI provider returned HTTP ${res.status}.`,
      };
    }
    return {
      check: "ai",
      ok: true,
      detail: hasKey ? "AI provider key configured; API reachable." : "AI API reachable; OPENROUTER_API_KEY not configured.",
    };
  } catch (e) {
    return {
      check: "ai",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 300) : "AI probe failed",
    };
  }
}

/** Run every probe and record results + failures. Called hourly by the cron. */
export const runHealthChecks = internalAction({
  args: {},
  handler: async (ctx): Promise<{ results: ProbeResult[] }> => {
    const results = await Promise.all([probeAuth(), probeGithub(), probeAi()]);
    for (const result of results) {
      await ctx.runMutation(internal.security.healthRecord, result).catch(() => {});
      if (!result.ok) {
        await ctx
          .runMutation(internal.security.logError, {
            source: "health",
            message: `Health check failed: ${result.check}`,
            detail: result.detail ?? "",
          })
          .catch(() => {});
      }
    }
    return { results };
  },
});

/**
 * Admin-only: the latest result of each health check plus the most recent
 * run timestamp. Mirrors the admin-console authorization model.
 */
export const recentHealthChecks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { authorized: false as const };
    const user = await ctx.db.get(userId);
    const billingRow = await ctx.db
      .query("billing")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    const plan = (billingRow?.plan ?? "free") as string;
    if (user?.role !== "admin" && plan !== "team" && plan !== "enterprise") {
      return { authorized: false as const };
    }
    const rows = await ctx.db.query("healthChecks").collect();
    const sorted = rows.sort((a, b) => b.checkedAt - a.checkedAt);
    const latestRun = sorted[0]?.checkedAt ?? null;
    const latest: Record<string, { ok: boolean; detail: string | null; checkedAt: number }> = {};
    for (const row of sorted) {
      if (!(row.check in latest)) {
        latest[row.check] = {
          ok: row.ok,
          detail: row.detail ?? null,
          checkedAt: row.checkedAt,
        };
      }
    }
    return { authorized: true as const, latestRun, checks: latest };
  },
});
