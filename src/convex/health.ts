import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { fetchWithRetry } from "./net";

const GITHUB_API = "https://api.github.com";
const DEFAULT_OTP_RELAY_URL = "https://auth.freebuff.app/send_otp";

type ProbeName =
  | "auth"
  | "otp"
  | "github"
  | "ai"
  | "email"
  | "airbrake"
  | "posthog";

interface ProbeResult {
  check: ProbeName;
  ok: boolean;
  detail?: string;
}

async function probeAuth(): Promise<ProbeResult> {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) {
    return {
      check: "auth",
      ok: false,
      detail: "CONVEX_SITE_URL is not configured.",
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

/** Configuration-only probe: never sends a real OTP or exposes the relay key. */
async function probeOtp(): Promise<ProbeResult> {
  if (!process.env.FREEBUFF_EMAIL_API_KEY?.trim()) {
    return {
      check: "otp",
      ok: false,
      detail: "FREEBUFF_EMAIL_API_KEY is not configured; email OTP sign-in cannot send codes.",
    };
  }

  const rawUrl = process.env.FREEBUFF_EMAIL_API_URL?.trim() || DEFAULT_OTP_RELAY_URL;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") {
      return {
        check: "otp",
        ok: false,
        detail: "FREEBUFF_EMAIL_API_URL must use HTTPS.",
      };
    }
  } catch {
    return {
      check: "otp",
      ok: false,
      detail: "FREEBUFF_EMAIL_API_URL is invalid.",
    };
  }

  return {
    check: "otp",
    ok: true,
    detail: "Email OTP relay credential and HTTPS endpoint are configured.",
  };
}

async function probeGithub(): Promise<ProbeResult> {
  const hasKeys = !!(
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
  );
  if (!hasKeys) {
    return {
      check: "github",
      ok: false,
      detail: "GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET are not configured.",
    };
  }
  try {
    const res = await fetchWithRetry(`${GITHUB_API}/rate_limit`, undefined, {
      attempts: 2,
    });
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
      detail: "GitHub OAuth keys configured; API reachable.",
    };
  } catch (e) {
    return {
      check: "github",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 300) : "GitHub probe failed",
    };
  }
}

async function probeAi(): Promise<ProbeResult> {
  const hasKey = !!process.env.OPENROUTER_API_KEY;
  if (!hasKey) {
    return {
      check: "ai",
      ok: true,
      detail: "OPENROUTER_API_KEY is not configured — Ask Aria is disabled.",
    };
  }
  try {
    const res = await fetchWithRetry(
      "https://openrouter.ai/api/v1/models",
      { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } },
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
      detail: "AI provider key configured; API reachable.",
    };
  } catch (e) {
    return {
      check: "ai",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 300) : "AI probe failed",
    };
  }
}

/** Optional notification-email integration; separate from critical OTP auth. */
async function probeEmail(): Promise<ProbeResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return {
      check: "email",
      ok: true,
      detail: "RESEND_API_KEY not configured — email notifications disabled.",
    };
  }
  try {
    const res = await fetchWithRetry(
      "https://api.resend.com/domains",
      { headers: { Authorization: `Bearer ${key}` } },
      { attempts: 2 },
    );
    return res.ok
      ? { check: "email", ok: true, detail: "Resend API key valid; API reachable." }
      : { check: "email", ok: false, detail: `Resend returned HTTP ${res.status}.` };
  } catch (e) {
    return {
      check: "email",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 300) : "Resend probe failed",
    };
  }
}

async function probeAirbrake(): Promise<ProbeResult> {
  const projectId = process.env.AIRBRAKE_PROJECT_ID;
  const key = process.env.AIRBRAKE_API_KEY;
  if (!projectId || !key) {
    return {
      check: "airbrake",
      ok: true,
      detail: "Airbrake is not configured — external error mirroring disabled.",
    };
  }
  try {
    const res = await fetchWithRetry(
      `https://api.airbrake.io/api/v4/projects/${encodeURIComponent(projectId)}`,
      { headers: { Authorization: `Bearer ${key}` } },
      { attempts: 2 },
    );
    return res.ok
      ? { check: "airbrake", ok: true, detail: "Airbrake project key valid; API reachable." }
      : { check: "airbrake", ok: false, detail: `Airbrake returned HTTP ${res.status}.` };
  } catch (e) {
    return {
      check: "airbrake",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 300) : "Airbrake probe failed",
    };
  }
}

async function probePosthog(): Promise<ProbeResult> {
  const key = process.env.POSTHOG_API_KEY;
  if (!key) {
    return {
      check: "posthog",
      ok: true,
      detail: "POSTHOG_API_KEY not configured — analytics disabled.",
    };
  }
  try {
    const host = process.env.POSTHOG_API_HOST ?? "https://us.i.posthog.com";
    const res = await fetchWithRetry(
      `${host}/decide/?v=3`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key }),
      },
      { attempts: 2 },
    );
    return res.ok
      ? { check: "posthog", ok: true, detail: "PostHog key valid; API reachable." }
      : { check: "posthog", ok: false, detail: `PostHog returned HTTP ${res.status}.` };
  } catch (e) {
    return {
      check: "posthog",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 300) : "PostHog probe failed",
    };
  }
}

export const runHealthChecks = internalAction({
  args: {},
  handler: async (ctx): Promise<{ results: ProbeResult[] }> => {
    const results = await Promise.all([
      probeAuth(),
      probeOtp(),
      probeGithub(),
      probeAi(),
      probeEmail(),
      probeAirbrake(),
      probePosthog(),
    ]);
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

/** Deployment health is platform-internal, never a paid-plan entitlement. */
export const recentHealthChecks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { authorized: false as const };
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") return { authorized: false as const };

    const rows = await ctx.db.query("healthChecks").collect();
    const sorted = rows.sort((a, b) => b.checkedAt - a.checkedAt);
    const latestRun = sorted[0]?.checkedAt ?? null;
    const latest: Record<
      string,
      { ok: boolean; detail: string | null; checkedAt: number }
    > = {};
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
