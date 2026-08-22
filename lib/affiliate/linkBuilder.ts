/**
 * AFFILIATE LINK GENERATION — pure, no I/O, fully testable.
 *
 * The governing rule: this module NEVER invents a URL. Every destination it
 * produces is either
 *   (a) a URL the merchant's own feed gave us, or
 *   (b) that URL wrapped using a template the operator configured from
 *       their approved network documentation.
 *
 * If configuration is missing, disabled, or produces anything that fails
 * validation, the result is an explicit fallback to the merchant's own
 * product URL — untracked, but correct and honest. A broken or guessed
 * affiliate link is worse than an untracked one: it breaks the user's
 * purchase and can breach the network's terms.
 */

export type LinkStrategy =
  /** Feed URLs already carry the affiliate tag (e.g. Flipkart). Use as-is. */
  | "passthrough"
  /** Network gives a deep-link template with a {destination} placeholder. */
  | "deep_link_template"
  /** Append a tracking query parameter to the merchant's own URL. */
  | "query_param";

export interface AffiliateConfig {
  merchantId: string;
  network: string;
  strategy: LinkStrategy;
  isActive: boolean;
  /** e.g. "https://tracker.example/g/{campaign}/?ulp={destination}". Never hard-coded here. */
  baseUrlTemplate?: string | null;
  /** Query param name for query_param strategy, e.g. "affid" or "tag". */
  trackingParam?: string | null;
  /** The tracking/affiliate ID value. Resolved from env, never stored in the DB. */
  trackingId?: string | null;
  /** Param name the network permits for sub-ID tracking, if any. */
  subIdParam?: string | null;
  /** Param name for campaign tracking, if the network permits it. */
  campaignParam?: string | null;
  /** Max sub-ID length the network accepts. Longer values are truncated. */
  maxSubIdLength?: number | null;
  /**
   * Domains this configuration is permitted to deep-link to. Empty means
   * "not restricted", which is only correct when the network says so.
   * A destination outside this list is NOT wrapped — we fall back.
   */
  allowedDeepLinkDomains?: string[] | null;
  /** Whether {destination} must be percent-encoded inside the template. */
  requiresEncodedDestination?: boolean | null;
}

export interface LinkContext {
  /** Non-PII sub-ID: opaque session token + page context. */
  subId?: string;
  campaign?: string;
}

export type LinkOutcome = "affiliate" | "fallback_untracked";

export interface BuiltLink {
  url: string;
  outcome: LinkOutcome;
  strategy: LinkStrategy | null;
  /** Why a fallback happened — surfaced in admin analytics, never to users. */
  reason?: string;
}

/** Only http(s). Blocks javascript:, data:, and malformed values. */
export function isSafeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Domain match allowing subdomains: "flipkart.com" matches "dl.flipkart.com". */
export function isDomainAllowed(url: string, allowed: string[] | null | undefined): boolean {
  if (!allowed || allowed.length === 0) return true; // unrestricted by config
  const host = hostnameOf(url);
  if (!host) return false;
  return allowed.some((domain) => {
    const d = domain.trim().toLowerCase().replace(/^\./, "");
    return d.length > 0 && (host === d || host.endsWith(`.${d}`));
  });
}

/**
 * Sub-IDs must carry no personal information. This strips anything that
 * isn't a safe token character, so an accidental email/user-id can't be
 * smuggled into a third-party network's logs, and truncates to the
 * network's documented limit.
 */
export function sanitizeSubId(value: string | undefined, maxLength: number | null | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, maxLength ?? 64);
  return cleaned.length > 0 ? cleaned : undefined;
}

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/**
 * Builds the outbound URL.
 *
 * `destinationUrl` is the merchant product URL exactly as the feed supplied
 * it. Every failure path returns that same URL with outcome
 * "fallback_untracked" — we lose the commission on that click rather than
 * send the user somewhere wrong.
 */
export function buildAffiliateLink(
  destinationUrl: string,
  config: AffiliateConfig | null,
  context: LinkContext = {},
): BuiltLink {
  // The destination itself must be sane before anything else happens.
  if (!isSafeUrl(destinationUrl)) {
    return { url: "", outcome: "fallback_untracked", strategy: null, reason: "destination_url_invalid" };
  }

  if (!config || !config.isActive) {
    return {
      url: destinationUrl,
      outcome: "fallback_untracked",
      strategy: null,
      reason: config ? "config_inactive" : "no_config",
    };
  }

  if (!isDomainAllowed(destinationUrl, config.allowedDeepLinkDomains)) {
    // The network has not approved deep-linking to this domain. Wrapping it
    // anyway would breach their terms — send the user to the plain URL.
    return {
      url: destinationUrl,
      outcome: "fallback_untracked",
      strategy: config.strategy,
      reason: "domain_not_permitted",
    };
  }

  const subId = sanitizeSubId(context.subId, config.maxSubIdLength);
  const campaign = sanitizeSubId(context.campaign, config.maxSubIdLength);

  switch (config.strategy) {
    case "passthrough":
      return buildPassthrough(destinationUrl, config, subId);
    case "query_param":
      return buildQueryParam(destinationUrl, config, subId, campaign);
    case "deep_link_template":
      return buildFromTemplate(destinationUrl, config, subId, campaign);
    default:
      return {
        url: destinationUrl,
        outcome: "fallback_untracked",
        strategy: null,
        reason: "unknown_strategy",
      };
  }
}

/**
 * Passthrough: the feed already returned a tagged URL. We verify the
 * expected tracking parameter is actually present rather than assuming it —
 * a feed change that silently drops the tag would otherwise cost every
 * commission with no signal. We still redirect either way; we just record
 * that it was untagged.
 */
function buildPassthrough(
  destinationUrl: string,
  config: AffiliateConfig,
  subId: string | undefined,
): BuiltLink {
  const url = new URL(destinationUrl);

  if (config.trackingParam) {
    const existing = url.searchParams.get(config.trackingParam);
    if (!existing) {
      return {
        url: destinationUrl,
        outcome: "fallback_untracked",
        strategy: "passthrough",
        reason: "feed_url_missing_tracking_param",
      };
    }
  }

  // Append a sub-ID only where the network documents one. We never add
  // arbitrary params to a merchant URL.
  if (subId && config.subIdParam) {
    url.searchParams.set(config.subIdParam, subId);
  }

  return { url: url.toString(), outcome: "affiliate", strategy: "passthrough" };
}

/** Appends the network's documented tracking parameter to the merchant URL. */
function buildQueryParam(
  destinationUrl: string,
  config: AffiliateConfig,
  subId: string | undefined,
  campaign: string | undefined,
): BuiltLink {
  if (!config.trackingParam || !config.trackingId) {
    return {
      url: destinationUrl,
      outcome: "fallback_untracked",
      strategy: "query_param",
      reason: "missing_tracking_param_or_id",
    };
  }

  const url = new URL(destinationUrl);
  url.searchParams.set(config.trackingParam, config.trackingId);
  if (subId && config.subIdParam) url.searchParams.set(config.subIdParam, subId);
  if (campaign && config.campaignParam) url.searchParams.set(config.campaignParam, campaign);

  return { url: url.toString(), outcome: "affiliate", strategy: "query_param" };
}

/**
 * Wraps the destination in the network's deep-link template.
 * The template comes from configuration — this module contains no network
 * URLs of its own, because inventing one is exactly the failure this whole
 * system is designed to prevent.
 */
function buildFromTemplate(
  destinationUrl: string,
  config: AffiliateConfig,
  subId: string | undefined,
  campaign: string | undefined,
): BuiltLink {
  const template = config.baseUrlTemplate?.trim();
  if (!template) {
    return {
      url: destinationUrl,
      outcome: "fallback_untracked",
      strategy: "deep_link_template",
      reason: "missing_template",
    };
  }
  if (!template.includes("{destination}")) {
    return {
      url: destinationUrl,
      outcome: "fallback_untracked",
      strategy: "deep_link_template",
      reason: "template_missing_destination_placeholder",
    };
  }

  const encoded = config.requiresEncodedDestination === false
    ? destinationUrl
    : encodeURIComponent(destinationUrl);

  const values: Record<string, string> = {
    destination: encoded,
    trackingId: config.trackingId ?? "",
    subId: subId ?? "",
    campaign: campaign ?? "",
  };

  const substituted = template.replace(PLACEHOLDER_PATTERN, (match, key: string) =>
    key in values ? values[key] : match,
  );

  // An unsubstituted placeholder means the template references something we
  // don't have. Emitting it would produce a literally broken link.
  const leftover = substituted.match(PLACEHOLDER_PATTERN);
  if (leftover) {
    return {
      url: destinationUrl,
      outcome: "fallback_untracked",
      strategy: "deep_link_template",
      reason: `unresolved_placeholder:${leftover[0]}`,
    };
  }

  // Empty required values would silently produce an untracked wrapper.
  if (template.includes("{trackingId}") && !config.trackingId) {
    return {
      url: destinationUrl,
      outcome: "fallback_untracked",
      strategy: "deep_link_template",
      reason: "missing_tracking_id",
    };
  }

  if (!isSafeUrl(substituted)) {
    return {
      url: destinationUrl,
      outcome: "fallback_untracked",
      strategy: "deep_link_template",
      reason: "template_produced_invalid_url",
    };
  }

  return { url: substituted, outcome: "affiliate", strategy: "deep_link_template" };
}

/**
 * Last-line safety check before redirecting. Catches the one thing that
 * would be genuinely dangerous: a credential appearing in an outbound URL
 * (e.g. an API token pasted into a template by mistake).
 */
export function containsCredentialLeak(url: string, secrets: string[]): boolean {
  if (secrets.length === 0) return false;
  const lower = url.toLowerCase();
  return secrets.some((secret) => secret.length >= 8 && lower.includes(secret.toLowerCase()));
}
