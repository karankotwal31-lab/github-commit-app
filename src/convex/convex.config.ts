import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

/**
 * App-owned root routing: the static frontend is served from the deployment's
 * root (https://<deployment>.convex.site) with SPA fallback to index.html,
 * while every existing HTTP route keeps its exact URL — the GitHub OAuth
 * callback (/api/github/callback), the Stripe webhook (/api/stripe/webhook),
 * and Convex Auth's routes. Exact app routes always win over the static
 * catch-all, so none of these break.
 */
const app = defineApp();
app.use(staticHosting);

export default app;
