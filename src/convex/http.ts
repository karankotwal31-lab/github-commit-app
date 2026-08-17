import { httpRouter } from "convex/server";
import { type GenericId } from "convex/values";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal, components } from "./_generated/api";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { stripeWebhook } from "./stripeWebhook";
import { fetchWithRetry } from "./net";
import { GITHUB_CALLBACK_PER_MINUTE } from "./security";

const http = httpRouter();

auth.addHttpRoutes(http);

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "aria";

/**
 * GitHub redirects here after the user authorizes. Exchanges the code for an
 * access token, stores the connection, and sends the user back to the app.
 */
http.route({
  path: "/api/github/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    // The request arrives at the Convex site domain, so its origin IS the
    // site URL — don't depend on env vars that may be unset.
    const siteUrl =
      new URL(request.url).origin ||
      process.env.CONVEX_SITE_URL ||
      process.env.SITE_URL ||
      "";
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    const fail = (origin: string | null, reason: string) =>
      Response.redirect(`${origin ?? siteUrl}/dashboard?github=${reason}`);

    if (!code || !state) {
      return fail(null, "error");
    }

    let stateDoc: { userId: GenericId<"users">; origin: string | null };
    try {
      stateDoc = await ctx.runMutation(internal.github.consumeOAuthState, {
        state,
      });
    } catch {
      return fail(null, "error");
    }

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return fail(stateDoc.origin, "config");
    }

    // Rate limit the callback per source IP (Part D): this is the only
    // unauthenticated entry into GitHub OAuth, so it's the one endpoint that
    // deserves an IP-keyed throttle against token-exchange abuse.
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("cf-connecting-ip")?.trim() ??
      "unknown";
    const ipAllowed = await ctx.runMutation(internal.security.bumpRateLimit, {
      bucket: `ghcallback:${clientIp}`,
      limit: GITHUB_CALLBACK_PER_MINUTE,
    });
    if (!ipAllowed) {
      return fail(stateDoc.origin, "error");
    }

    // Exchange the authorization code for an access token (retried
    // automatically — Part D — since this is a network call to GitHub).
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
          redirect_uri: `${siteUrl}/api/github/callback`,
        }),
      },
    );
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
    };
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return fail(stateDoc.origin, "error");
    }

    // Fetch the profile so the app can show who is connected.
    const profileRes = await fetchWithRetry(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
      },
    });
    if (!profileRes.ok) {
      return fail(stateDoc.origin, "error");
    }
    const profile = (await profileRes.json()) as {
      login: string;
      name?: string | null;
      avatar_url?: string | null;
    };

    await ctx.runMutation(internal.github.saveConnection, {
      userId: stateDoc.userId,
      token: accessToken,
      login: profile.login,
      name: profile.name ?? undefined,
      avatar: profile.avatar_url ?? undefined,
    });

    return Response.redirect(`${stateDoc.origin ?? siteUrl}/dashboard?github=connected`);
  }),
});

/**
 * Stripe webhook — implemented in src/convex/stripeWebhook.ts (it needs the
 * node runtime to import the Stripe SDK); mounted here as a plain route.
 */
http.route({
  path: "/api/stripe/webhook",
  method: "POST",
  handler: stripeWebhook,
});

// ---------------------------------------------------------------------------
// Aria CLI — read-only endpoints authenticated with personal access tokens
// (created in the app under Platform → CLI & API). The CLI never sees the
// GitHub OAuth token; it only gets the user's own data, scoped to them.
// ---------------------------------------------------------------------------

const bearerOf = (request: Request): string | null =>
  request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;

const unauthorized = () =>
  Response.json(
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
    return Response.json(data);
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
    return Response.json(data);
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
    return Response.json(data);
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
    return Response.json(data);
  }),
});

// Serve the built frontend (dist/) from the deployment root with SPA
// fallback to index.html. Exact routes registered above always win over
// this static catch-all.
registerStaticRoutes(http, components.staticHosting);

export default http;