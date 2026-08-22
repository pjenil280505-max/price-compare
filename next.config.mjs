/**
 * Security headers are applied to every response. CSP is deliberately
 * absent for now — see the note below.
 */
const securityHeaders = [
  // Blocks MIME-sniffing, which can turn an uploaded/proxied file into an
  // executable script in older browsers.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking: nothing in this app is meant to be framed.
  { key: "X-Frame-Options", value: "DENY" },
  // Send only the origin cross-site, so merchant redirect targets never
  // receive a user's full search URL in the Referer header.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Features this app never uses.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // HSTS. Only meaningful over HTTPS; harmless in local http development.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,

  images: {
    // Every hostname that can appear in a product/merchant imageUrl must be
    // listed here (or proxied through your own domain).
    // See "Image domains" in README.md before going live.
    remotePatterns: [
      // { protocol: "https", hostname: "images.example-merchant.com" },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Outbound affiliate redirects must never be cached by a shared
        // proxy: the click log would be skipped and attribution lost.
        source: "/go/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        // Account pages contain personal data. A shared cache holding these
        // is a cross-user data leak.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

/*
 * CONTENT-SECURITY-POLICY — NOT YET ENABLED, deliberately.
 *
 * A CSP must enumerate every image host, and those hosts come from merchant
 * feeds that aren't connected yet (see docs/CONNECTORS.md). Shipping a CSP
 * with a guessed host list would either break every product image or be so
 * permissive it provides no protection.
 *
 * Add it once real feeds are live, roughly:
 *   default-src 'self';
 *   img-src 'self' data: https://<merchant-cdn-hosts>;
 *   script-src 'self' 'unsafe-inline';   // Next.js requires inline bootstrap
 *   connect-src 'self' https://<project>.supabase.co;
 *   frame-ancestors 'none';
 * Deploy in Report-Only first and watch for violations before enforcing.
 */

export default nextConfig;
