/**
 * CLICK TRACKING — deliberately minimal.
 *
 * What we record: which offer, which merchant, whether the link was
 * actually tracked, a coarse device bucket, and an opaque session token.
 *
 * What we deliberately do NOT record: raw User-Agent (a strong browser
 * fingerprint), IP address, full referrer with query string, or anything
 * tied to a person across sessions. The analytics questions this system
 * needs answered — "which products get clicked", "is our affiliate tagging
 * working", "mobile vs desktop" — are all answerable without any of that.
 */

export type DeviceType = "mobile" | "tablet" | "desktop" | "bot" | "unknown";
export type Platform = "android" | "ios" | "windows" | "macos" | "linux" | "other" | "unknown";

export interface ClickContext {
  deviceType: DeviceType;
  platform: Platform;
  /** Path only — query strings can carry search terms and IDs. */
  referrerPath: string | null;
}

const BOT_PATTERN = /\b(bot|crawler|spider|crawling|slurp|bingpreview|headless|curl|wget|python-requests)\b/i;

/**
 * Buckets a User-Agent into device + platform, then discards it.
 * The UA never reaches the database.
 */
export function deriveDeviceContext(userAgent: string | null): { deviceType: DeviceType; platform: Platform } {
  if (!userAgent) return { deviceType: "unknown", platform: "unknown" };

  const ua = userAgent.toLowerCase();

  if (BOT_PATTERN.test(ua)) return { deviceType: "bot", platform: "other" };

  let platform: Platform = "other";
  if (/android/.test(ua)) platform = "android";
  else if (/iphone|ipad|ipod/.test(ua)) platform = "ios";
  else if (/windows/.test(ua)) platform = "windows";
  else if (/mac os x|macintosh/.test(ua)) platform = "macos";
  else if (/linux/.test(ua)) platform = "linux";

  let deviceType: DeviceType;
  // Order matters: iPads report "mobile" in some UA strings.
  if (/ipad|tablet|\bkindle\b|playbook|silk/.test(ua)) deviceType = "tablet";
  else if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(ua)) deviceType = "mobile";
  else if (/android/.test(ua)) deviceType = "tablet"; // Android without "mobile" = tablet
  else if (platform !== "other") deviceType = "desktop";
  else deviceType = "unknown";

  return { deviceType, platform };
}

/**
 * Strips a referrer to its path. A full referrer URL can contain search
 * queries, and on some sites, tokens — none of which we need to know that
 * a click came from "/search" versus "/products/x".
 */
export function sanitizeReferrer(referrer: string | null, ownOrigin?: string): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    // Only record internal referrers. Where a user came from before our
    // site is not ours to log.
    if (ownOrigin) {
      const own = new URL(ownOrigin);
      if (url.hostname !== own.hostname) return null;
    }
    return url.pathname.slice(0, 255);
  } catch {
    return null;
  }
}

export function buildClickContext(request: Request, ownOrigin?: string): ClickContext {
  const { deviceType, platform } = deriveDeviceContext(request.headers.get("user-agent"));
  return {
    deviceType,
    platform,
    referrerPath: sanitizeReferrer(request.headers.get("referer"), ownOrigin),
  };
}

/**
 * Builds a sub-ID from non-identifying context. Networks that support
 * sub-IDs let us attribute a conversion back to a page type, which is
 * genuinely useful, without sending them anything about the person.
 *
 * Format: <sessionToken>-<pageContext>. Both are opaque.
 */
export function buildSubId(sessionToken: string | null, pageContext?: string): string | undefined {
  if (!sessionToken) return undefined;
  const context = pageContext?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16);
  return context ? `${sessionToken}-${context}` : sessionToken;
}

/**
 * Generates an opaque session token. Random, not derived from any user
 * attribute, so it cannot be reversed into an identity or correlated with
 * a person across a cookie clear.
 */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const SESSION_COOKIE_NAME = "pc_sid";
/** 30 days — long enough to deduplicate a shopping session, short enough not to be a durable identifier. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
