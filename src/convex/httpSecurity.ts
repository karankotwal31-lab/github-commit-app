/**
 * Standard security headers, applied to every HTTP response this app sends.
 *
 * Previously defined in http.ts but never actually called anywhere — every
 * route returned its Response directly, so none of these headers shipped in
 * production. Moved here so both http.ts and stripeWebhook.ts (and any
 * future route file) apply it consistently instead of each route needing to
 * remember to call it.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  // Prevent MIME-type sniffing.
  headers.set("X-Content-Type-Options", "nosniff");
  // Clickjacking protection.
  headers.set("X-Frame-Options", "DENY");
  // XSS filter (legacy browsers).
  headers.set("X-XSS-Protection", "1; mode=block");
  // Referrer policy — send origin only on cross-origin.
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Permissions policy — disable camera, microphone, geolocation by default.
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  // Strict Transport Security — 1 year, include subdomains.
  headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  // Content Security Policy — restrict resource origins. Tighten in
  // production by replacing 'unsafe-inline' with nonce-based CSP.
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: blob: https:; " +
      "connect-src 'self' https://*.convex.cloud https://*.convex.site https://api.github.com https://github.com https://auth.freebuff.app; " +
      "frame-ancestors 'none';",
  );
  // Remove server identification.
  headers.delete("Server");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
