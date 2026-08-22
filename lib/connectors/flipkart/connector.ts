import "server-only";

import { fetchJson, RateLimiter } from "../http";
import {
  FatalConnectorError,
  type ConnectorContext,
  type ConnectorFailure,
  type ConnectorPage,
  type MerchantConnector,
  type NormalizedProduct,
  type SyncMode,
} from "../types";
import {
  mapFlipkartProduct,
  type FkApiDirectory,
  type FkDeltaVersionResponse,
  type FkFeedResponse,
} from "./mapper";

/**
 * FLIPKART AFFILIATE CONNECTOR
 *
 * Implemented against the official Affiliate API 1.0 documentation:
 *   https://affiliate.flipkart.com/api-docs/af_prod_ref.html
 *
 * REQUIRED APPROVAL & CREDENTIALS — see docs/CONNECTORS.md:
 *   1. An approved Flipkart Affiliate account (affiliate.flipkart.com).
 *   2. An Affiliate Tracking ID and an API Token generated from the
 *      affiliate dashboard's API section.
 *   Env vars: FLIPKART_AFFILIATE_ID, FLIPKART_AFFILIATE_TOKEN
 *
 * DOCUMENTED BEHAVIOUR THIS CONNECTOR RELIES ON:
 *   - Auth is via Fk-Affiliate-Id / Fk-Affiliate-Token request headers.
 *   - Feed URLs are DISCOVERED from the Product Feed Listing API, never
 *     hand-constructed. They carry expiresAt + sig query params which the
 *     docs say must not be modified, and are valid for 10 hours only.
 *   - Pagination is via the `nextUrl` field; batch size is 500 per page.
 *   - Delta sync is version-based: fetch the category's current version,
 *     then request fromVersion/{lastSeenVersion}.
 *   - Product URLs come back already carrying the affiliate tracking id.
 *
 * KNOWN LIMITATIONS (not workarounds — facts about their API):
 *   - No GTIN/EAN/UPC is published. See mapper.ts.
 *   - Books and eBooks categories are unavailable.
 */

const API_BASE = "https://affiliate-api.flipkart.net/affiliate";
const FEED_VARIANT = "v1.1.0";

interface FlipkartConfig {
  /** Category resourceNames to sync. Empty/absent = all available categories. */
  categories?: string[];
  /** Ask Flipkart to return only in-stock items (documented `inStock` filter). */
  inStockOnly?: boolean;
  /** Safety cap on pages per category per run, so one run can't span forever. */
  maxPagesPerCategory?: number;
}

export const flipkartConnector: MerchantConnector = {
  key: "flipkart_affiliate",
  displayName: "Flipkart Affiliate",
  supportedModes: ["full_catalog", "delta_price"],
  requiredCredentials: ["AFFILIATE_ID", "AFFILIATE_TOKEN"],
  // Flipkart's docs don't publish a specific rate limit. 2 req/s is a
  // deliberately conservative default — raise it only if their support
  // confirms a higher ceiling for your account.
  rateLimitPerSecond: 2,

  async testConnection(ctx) {
    try {
      await fetchDirectory(ctx);
      return { ok: true, message: "Credentials accepted; feed listing reachable." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Connection failed" };
    }
  },

  async *sync(mode: SyncMode, ctx: ConnectorContext): AsyncGenerator<ConnectorPage, void, void> {
    const config = ctx.config as FlipkartConfig;
    const maxPages = config.maxPagesPerCategory ?? 200;
    const rateLimiter = new RateLimiter(flipkartConnector.rateLimitPerSecond);

    const directory = await fetchDirectory(ctx, rateLimiter);
    const listings = directory.apiGroups?.affiliate?.apiListings ?? {};

    const requested = config.categories?.filter(Boolean) ?? [];
    const categoryNames = requested.length > 0
      ? requested.filter((name) => name in listings)
      : Object.keys(listings);

    if (requested.length > 0) {
      const missing = requested.filter((name) => !(name in listings));
      if (missing.length > 0) {
        ctx.log(`Configured categories not present in feed listing: ${missing.join(", ")}`);
      }
    }

    ctx.log(`Syncing ${categoryNames.length} categories in ${mode} mode`);

    const cursor = { ...(ctx.cursor as { categoryVersions?: Record<string, number> }) };
    const categoryVersions: Record<string, number> = { ...(cursor.categoryVersions ?? {}) };

    for (const categoryName of categoryNames) {
      if (ctx.signal.aborted) return;

      const variant = listings[categoryName]?.availableVariants?.[FEED_VARIANT];
      if (!variant) {
        ctx.log(`Skipping ${categoryName}: no ${FEED_VARIANT} variant offered`);
        continue;
      }

      let url: string | null;

      if (mode === "delta_price" && categoryVersions[categoryName] != null) {
        const deltaGet = variant.deltaGet;
        if (!deltaGet) {
          ctx.log(`Skipping delta for ${categoryName}: no deltaGet URL`);
          continue;
        }
        url = buildDeltaUrl(deltaGet, categoryVersions[categoryName]);
      } else {
        url = variant.get;
      }

      if (!url) {
        ctx.log(`Skipping ${categoryName}: no feed URL`);
        continue;
      }

      if (config.inStockOnly) url = appendParam(url, "inStock", "true");

      // Record the category's current version BEFORE reading the feed, so a
      // product changing mid-run is picked up by the next delta rather than
      // being skipped over.
      if (variant.deltaGet) {
        const version = await fetchCategoryVersion(variant.deltaGet, ctx, rateLimiter);
        if (version != null) categoryVersions[categoryName] = version;
      }

      let pageCount = 0;

      while (url && pageCount < maxPages) {
        if (ctx.signal.aborted) return;

        // Explicit annotation: `url` is reassigned from `response.nextUrl`
        // below, which makes TS attempt circular inference without it.
        const response: FkFeedResponse = await fetchJson<FkFeedResponse>(url, {
          headers: credentialHeaders(ctx),
          rateLimiter,
          signal: ctx.signal,
          onRetry: (attempt, delayMs, reason) =>
            ctx.log(`Retry ${attempt} for ${categoryName} in ${delayMs}ms (${reason})`),
        });

        const failures: ConnectorFailure[] = [];
        // Annotated explicitly: an unannotated [] can infer as never[]
        // depending on the surrounding contextual type.
        const products: NormalizedProduct[] = [];

        for (const item of response.productInfoList ?? []) {
          const mapped = mapFlipkartProduct(item);
          if (mapped) {
            products.push(mapped);
          } else {
            failures.push({
              externalId: item.productBaseInfoV1?.productId,
              stage: "parse",
              reason: "Missing required fields (productId, title, productUrl, or price)",
              raw: item,
            });
          }
        }

        pageCount += 1;

        yield {
          products,
          failures,
          cursor: { categoryVersions },
        };

        url = response.nextUrl;
      }

      if (pageCount >= maxPages) {
        ctx.log(`Hit page cap (${maxPages}) for ${categoryName}; remainder resumes next run`);
      }
    }
  },
};

function credentialHeaders(ctx: ConnectorContext): Record<string, string> {
  return {
    "Fk-Affiliate-Id": ctx.credentials.AFFILIATE_ID,
    "Fk-Affiliate-Token": ctx.credentials.AFFILIATE_TOKEN,
  };
}

async function fetchDirectory(ctx: ConnectorContext, rateLimiter?: RateLimiter): Promise<FkApiDirectory> {
  const trackingId = ctx.credentials.AFFILIATE_ID;
  if (!trackingId) throw new FatalConnectorError("Missing Flipkart affiliate tracking ID");

  return fetchJson<FkApiDirectory>(`${API_BASE}/api/${encodeURIComponent(trackingId)}.json`, {
    headers: credentialHeaders(ctx),
    rateLimiter,
    signal: ctx.signal,
  });
}

/** The deltaGet URL with no fromVersion returns the category's current version. */
async function fetchCategoryVersion(
  deltaGetUrl: string,
  ctx: ConnectorContext,
  rateLimiter: RateLimiter,
): Promise<number | null> {
  try {
    const response = await fetchJson<FkDeltaVersionResponse>(deltaGetUrl, {
      headers: credentialHeaders(ctx),
      rateLimiter,
      signal: ctx.signal,
    });
    return response.version ?? null;
  } catch (error) {
    ctx.log(`Could not read category version: ${error instanceof Error ? error.message : "unknown"}`);
    return null;
  }
}

/**
 * Inserts `/fromVersion/{version}` before the `.json` extension, preserving
 * the expiresAt/sig query params, which the docs explicitly say must not be
 * modified. Built by string surgery on Flipkart's own URL rather than
 * constructed from scratch, so we never fabricate a signed URL.
 */
function buildDeltaUrl(deltaGetUrl: string, fromVersion: number): string {
  const url = new URL(deltaGetUrl);
  const match = url.pathname.match(/^(.*)\.(json|xml)$/);
  if (!match) return deltaGetUrl;

  url.pathname = `${match[1]}/fromVersion/${fromVersion}.${match[2]}`;
  return url.toString();
}

function appendParam(rawUrl: string, key: string, value: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set(key, value);
  return url.toString();
}
