/**
 * Canonical site configuration. One place decides the absolute base URL,
 * which every canonical link, sitemap entry, OG tag and JSON-LD node
 * derives from — mismatched hosts across those is a common and quietly
 * damaging SEO fault.
 */
export const SITE_NAME = "Price Compare";

export const SITE_DESCRIPTION =
  "Compare prices across every store we track. Verified prices, real price history, and honest freshness labelling on every listing.";

/**
 * Falls back to localhost so builds don't fail, but a real value must be
 * set in production: canonical URLs pointing at localhost would deindex
 * the site.
 */
export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Pages that must never be indexed: user data, admin, or infinite-surface. */
export const NOINDEX_PREFIXES = [
  "/admin",
  "/account",
  "/wishlist",
  "/alerts",
  "/notifications",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/unsubscribe",
  "/go",
  "/api",
];
