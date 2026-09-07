import { httpRouter } from "convex/server";
import { type GenericId } from "convex/values";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal, components } from "./_generated/api";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { stripeWebhook } from "./stripeWebhook";
import { fetchWithRetry } from "./net";
import { GITHUB_CALLBACK_PER_MINUTE } from "./security";

/** Security headers for app-owned HTTP API responses. */
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Cache-Control", headers.get("Cache-Control") ?? "no-store");
  headers.delete("Server");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function secureJson(data: unknown, init?: ResponseInit): Response {
  return withSecurityHeaders(Response.json(data, init));
}

function secureRedirect(url: string): Response {
  return withSecurityHeaders(Response.redirect(url));
}

function normalizedOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * OAuth state carries a return origin supplied by the signed-in client. Never
 * redirect to it unless it exactly matches a configured app origin.
 */
function trustedReturnOrigin(candidate: string | null, callbackOrigin: string): string {
  const allowed = new Set<string>([callbackOrigin]);
  const site = normalizedOrigin(process.env.SITE_URL);
  const convexSite = normalizedOrigin(process.env.CONVEX_SITE_URL);
  if (site) allowed.add(site);
  if (convexSite) allowed.add(convexSite);
  const requested = normalizedOrigin(candidate);
  return requested && allowed.has(requested) ? requested : callbackOrigin;
}

const http = httpRouter();
auth.addHttpRoutes(http);

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "aria";

http.route({
  path: "/api/github/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const requestUrl = new URL(request.url);
    const callbackOrigin = requestUrl.origin;
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");

    const fail = (origin: string | null, reason: string) => {
      const target = trustedReturnOrigin(origin, callbackOrigin);
      return secureRedirect(`${target}/dashboard?github=${reason}`);
    };

    if (!code || !state) return fail(null, "error");

    let stateDoc: { userId: GenericId<"users">; origin: string | null };
    try {
      stateDoc = await ctx.runMutation(internal.github.consumeOAuthState, { state });
    } catch {
      return fail(null, "error");
    }

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail(stateDoc.origin, "config");

    const clientIp =
      request.headers.get("cf-connecting-ip")?.trim() ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const ipAllowed = await ctx.runMutation(internal.security.bumpRateLimit, {
      bucket: `ghcallback:${clientIp}`,
      limit: GITHUB_CALLBACK_PER_MINUTE,
    });
    if (!ipAllowed) return fail(stateDoc.origin, "error");

    const tokenRes = await fetchWithRetry(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: `${callbackOrigin}/api/github/callback`,
        }),
      },
    );
    if (!tokenRes.ok) return fail(stateDoc.origin, "error");

    let tokenData: { access_token?: string; error?: string };
    try {
      tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    } catch {
      return fail(stateDoc.origin, "error");
    }
    const accessToken = tokenData.access_token;
    if (!accessToken) return fail(stateDoc.origin, "error");

    const profileRes = await fetchWithRetry(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
      },
    });
    if (!profileRes.ok) return fail(stateDoc.origin, "error");

    const profile = (await profileRes.json()) as {
      login?: string;
      name?: string | null;
      avatar_url?: string | null;
    };
    if (!profile.login) return fail(stateDoc.origin, "error");

    await ctx.runMutation(internal.github.saveConnection, {
      userId: stateDoc.userId,
      token: accessToken,
      login: profile.login,
      name: profile.name ?? undefined,
      avatar: profile.avatar_url ?? undefined,
    });

    const target = trustedReturnOrigin(stateDoc.origin, callbackOrigin);
    return secureRedirect(`${target}/dashboard?github=connected`);
  }),
});

http.route({
  path: "/api/stripe/webhook",
  method: "POST",
  handler: stripeWebhook,
});

const bearerOf = (request: Request): string | null => {
  const header = request.headers.get("authorization")?.trim();
  if (!header) return null;
  const match = /^Bearer\s+([^\s].*)$/i.exec(header);
  const token = match?.[1]?.trim();
  return token || null;
};

const unauthorized = () =>
  secureJson(
    { error: "Unauthorized — set ARIA_TOKEN or pass --token." },
    { status: 401 },
  );

http.route({
  path: "/api/cli/whoami",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = bearerOf(request);
    const userId = token
      ? await ctx.runMutation(internal.cli.verifyCliToken, { token })
      : null;
    if (!userId) return unauthorized();
    const data = await ctx.runQuery(internal.cli.whoamiByUser, { userId });
    return secureJson(data);
  }),
});

http.route({
  path: "/api/cli/repos",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = bearerOf(request);
    const userId = token
      ? await ctx.runMutation(internal.cli.verifyCliToken, { token })
      : null;
    if (!userId) return unauthorized();
    const data = await ctx.runQuery(internal.cli.reposByUser, { userId });
    return secureJson(data);
  }),
});

http.route({
  path: "/api/cli/inbox",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = bearerOf(request);
    const userId = token
      ? await ctx.runMutation(internal.cli.verifyCliToken, { token })
      : null;
    if (!userId) return unauthorized();
    const data = await ctx.runQuery(internal.cli.inboxByUser, { userId });
    return secureJson(data);
  }),
});

http.route({
  path: "/api/cli/prs",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = bearerOf(request);
    const userId = token
      ? await ctx.runMutation(internal.cli.verifyCliToken, { token })
      : null;
    if (!userId) return unauthorized();
    const data = await ctx.runAction(internal.cli.prsByUser, { userId });
    return secureJson(data);
  }),
});

http.route({
  path: "/api/cli/prs/{owner}/{repo}/{number}",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = bearerOf(request);
    const userId = token
      ? await ctx.runMutation(internal.cli.verifyCliToken, { token })
      : null;
    if (!userId) return unauthorized();

    const params = (request as unknown as { params: Record<string, string> }).params;
    const owner = params.owner ?? "";
    const repo = params.repo ?? "";
    const number = Number(params.number);
    if (!owner || !repo || !Number.isInteger(number) || number < 1) {
      return secureJson({ error: "Invalid PR reference." }, { status: 400 });
    }
    try {
      const data = await ctx.runAction(internal.cli.prDetailByUser, {
        userId,
        repo: `${owner}/${repo}`,
        number,
      });
      return secureJson(data);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Couldn't load this pull request.";
      return secureJson({ error: message }, { status: 404 });
    }
  }),
});

// In CI the committed Convex API binding intentionally uses the generic
// AnyComponents fallback because codegen requires a live Convex deployment.
// At deploy time Convex codegen narrows this reference to the static-hosting
// component API. The runtime reference is the same proxy in both cases, so the
// double assertion bridges only that build-time type gap without altering
// routing or component behavior.
registerStaticRoutes(
  http,
  components.staticHosting as unknown as Parameters<typeof registerStaticRoutes>[1],
);

export default http;
