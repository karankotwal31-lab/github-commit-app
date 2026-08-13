import { httpRouter } from "convex/server";
import { type GenericId } from "convex/values";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripeWebhook } from "./stripeWebhook";

const http = httpRouter();

auth.addHttpRoutes(http);

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "commit-app";

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

/**
 * Stripe webhook — implemented in src/convex/stripeWebhook.ts (it needs the
 * node runtime to import the Stripe SDK); mounted here as a plain route.
 */
http.route({
  path: "/api/stripe/webhook",
  method: "POST",
  handler: stripeWebhook,
});

export default http;