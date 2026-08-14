import type { AuthConfig } from "convex/server";

// Freebuff-signed federated tokens (see freebuff web's
// src/lib/vly-convex-jwt.ts) let a signed-in freebuff.com user carry their
// identity into this project without going through local sign-in.
//
// The issuer is intentionally hardcoded rather than read from
// process.env.VLY_CONVEX_AUTH_ISSUER: Convex's backend rejects auth configs
// that reference environment variables which are not set on the deployment,
// and Freebuff only injects that variable inside its own platform. On
// standalone deployments this provider is inert (no Freebuff-issued tokens
// are ever presented), and Aria's own sign-in (email OTP / anonymous plus
// the GitHub OAuth popup flow) is completely unaffected.
const freebuffIssuer = "https://freebuff.com";

export default {
  providers: [
    // Standard Convex Auth provider for this project's own sign-in (\"Get
    // Started\" email/guest, see src/convex/auth.ts). The deployment
    // self-issues JWTs (iss = CONVEX_SITE_URL, no `kid` header) validated
    // via OIDC discovery at `${domain}/.well-known/openid-configuration`,
    // served by auth.addHttpRoutes() in convex/http.ts. Do NOT convert this
    // entry to `type: \"customJwt\"` — that path rejects tokens without a
    // `kid` header, so sign-in would silently never confirm and RequireAuth
    // would loop back to /auth forever.
    {
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
    {
      type: "customJwt",
      issuer: freebuffIssuer,
      jwks: `${freebuffIssuer}/api/web/.well-known/jwks.json`,
      applicationID: "vly-convex",
      algorithm: "RS256",
    },
  ],
} satisfies AuthConfig;
