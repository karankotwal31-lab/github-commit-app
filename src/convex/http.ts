import { httpRouter } from "convex/server";
import { type GenericId } from "convex/values";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

auth.addHttpRoutes(http);

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "commit-app";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function randomHex(bytes: number) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Starts the GitHub OAuth flow. Requires a signed-in app user; binds the
 * authorization to that user via a one-time state token stored in Convex.
 */
http.route({
  path: "/api/github/authorize",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const siteUrl = process.env.CONVEX_SITE_URL ?? "";
    // The app passes its own origin explicitly (the preview may run in an
    // iframe where the Referer header is unavailable); fall back to Referer.
    const url = new URL(request.url);
    const originParam = url.searchParams.get("origin") ?? undefined;
    const origin = originParam?.startsWith("http") ? originParam : undefined;
    const referer = request.headers.get("referer");
    const originFromReferer = referer
      ? new URL(referer).origin
      : undefined;
    const resolvedOrigin = origin ?? originFromReferer;

    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return Response.redirect(
        `${resolvedOrigin ?? siteUrl}/auth?returnTo=%2Fdashboard`,
      );
    }
    const [userId] = identity.subject.split("|");

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return Response.redirect(
        `${resolvedOrigin ?? siteUrl}/dashboard?github=config`,
      );
    }

    const state = randomHex(32);
    await ctx.runMutation(internal.github.storeOAuthState, {
      state,
      userId: userId as GenericId<"users">,
      origin: resolvedOrigin,
      expiresAt: Date.now() + STATE_TTL_MS,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${siteUrl}/api/github/callback`,
      scope: "repo read:user user:email",
      state,
      allow_signup: "false",
    });
    return Response.redirect(`https://github.com/login/oauth/authorize?${params}`);
  }),
});

/**
 * GitHub redirects here after the user authorizes. Exchanges the code for an
 * access token, stores the connection, and sends the user back to the app.
 */
http.route({
  path: "/api/github/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const siteUrl = process.env.CONVEX_SITE_URL ?? "";
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

    // Exchange the authorization code for an access token.
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
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
    });
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
    };
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return fail(stateDoc.origin, "error");
    }

    // Fetch the profile so the app can show who is connected.
    const profileRes = await fetch(`${GITHUB_API}/user`, {
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

export default http;