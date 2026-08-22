/**
 * Resilience tests — degraded and hostile inputs.
 *
 * These exercise the paths that only occur when something is wrong: a
 * merchant feed returns nothing, a price is too old to trust, a product has
 * no offers, a user double-submits. Those paths are the least exercised in
 * development and the most damaging in production.
 */
import { performSearch } from "../lib/server/search.ts";
import { buildProductPricing, selectBestOffer, classifyFreshness, type MerchantPrice } from "../lib/pricing/engine.ts";
import { decideTrigger, type AlertCandidate } from "../lib/alerts/rules.ts";
import { matchProduct, type MatchCandidate } from "../lib/matching/matcher.ts";
import { extractVariant } from "../lib/matching/variant.ts";
import { buildAffiliateLink, type AffiliateConfig } from "../lib/affiliate/linkBuilder.ts";
import { classifyDeliveryResult, isDueForRetry } from "../lib/notifications/delivery.ts";
import { buildProductJsonLd } from "../lib/seo/structuredData.ts";
import { mapFlipkartProduct, type FkProductInfo } from "../lib/connectors/flipkart/mapper.ts";
import { normalizedProductSchema } from "../lib/connectors/types.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const NOW = new Date("2026-08-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function offer(over: Partial<MerchantPrice> = {}): MerchantPrice {
  return {
    offerId: "o1", merchantId: "m1", merchantName: "Store", merchantSlug: "s",
    merchantLogoUrl: "", price: 1000, inStock: true, buyUrl: "/go/o1",
    lastCheckedAt: hoursAgo(1), freshness: "fresh", isCheapest: true, ...over,
  };
}

// ---------------------------------------------------------------------
console.log("API failure: search when the database errors");
{
  const failingClient = {
    rpc: async () => ({ data: null, error: { message: "connection refused" } }),
    from: () => {
      const c: Record<string, unknown> = {};
      const self = () => c;
      Object.assign(c, { select: self, eq: self, order: self, limit: async () => ({ data: [], error: null }) });
      (c as { then?: unknown }).then = (r: (v: unknown) => void) => r({ data: [], error: null });
      return c;
    },
  } as never;

  let threw = false;
  try {
    await performSearch(failingClient, { query: "phone" });
  } catch {
    threw = true;
  }
  // The route wrapper turns this into a 500 with a safe message; what
  // matters is that it surfaces rather than returning fake empty results
  // that look like "no products exist".
  check("database error propagates rather than faking empty results", threw);
}

console.log("Missing data: search returns rows with nulls everywhere");
{
  const sparseClient = {
    rpc: async (name: string) =>
      name === "search_products"
        ? {
            data: [{
              product_id: "p1", slug: "p", title: "T",
              brand_name: null, category_name: null, primary_image_url: null,
              created_at: "2026-01-01T00:00:00Z", variant_id: "v1", variant_label: null,
              best_offer_id: null, best_price: null, best_mrp: null,
              best_discount_percent: null, best_in_stock: null, best_freshness: null,
              best_last_checked_at: null, merchant_id: null, merchant_name: null,
              merchant_slug: null, merchant_logo_url: null, offer_count: 0,
              avg_rating: null, total_reviews: 0, relevance: 0, total_count: 1,
            }],
            error: null,
          }
        : { data: [], error: null },
    from: () => {
      const c: Record<string, unknown> = {};
      const self = () => c;
      Object.assign(c, { select: self, eq: self, order: self, limit: async () => ({ data: [], error: null }) });
      (c as { then?: unknown }).then = (r: (v: unknown) => void) => r({ data: [], error: null });
      return c;
    },
  } as never;

  const result = await performSearch(sparseClient, { query: "phone" });
  const item = result.items[0];
  check("renders without throwing on all-null row", item != null);
  check("null price stays null, never 0", item.bestPrice === null, item.bestPrice);
  check("no buy link without an offer", item.buyUrl === null);
  check("variant label defaults", item.variantLabel === "Standard");
  check("image falls back to empty string", item.imageUrl === "");
}

console.log("Out-of-stock handling");
{
  const offers = [offer({ offerId: "cheap", price: 500, inStock: false }), offer({ offerId: "avail", price: 900 })];
  check("out-of-stock never becomes best price", selectBestOffer(offers)?.offerId === "avail");
}
{
  const pricing = buildProductPricing([offer({ inStock: false })], {
    lowestPrice: null, lowestPriceAt: null, highestPrice: null, highestPriceAt: null,
    averagePrice: null, observationDays: 0, observationCount: 0,
    hasSufficientData: false, isAtLowest: false, currentBestPrice: null,
  });
  check("all-out-of-stock yields no best offer", pricing.bestOffer === null);
  check("out-of-stock is not mislabelled as expired", pricing.allPricesExpired === false);
}

console.log("Stale prices never presented as current");
{
  const offers = [
    offer({ offerId: "expired", price: 100, freshness: "expired", lastCheckedAt: hoursAgo(500) }),
    offer({ offerId: "fresh", price: 900 }),
  ];
  check("expired cheaper price loses", selectBestOffer(offers)?.offerId === "fresh");
}
{
  // The same rule must hold in structured data, or search results
  // advertise a price the page itself refuses to show.
  const ld = buildProductJsonLd({
    product: { title: "T", slug: "t", imageUrls: [] },
    pricing: buildProductPricing([offer({ freshness: "expired", price: 100 })], {
      lowestPrice: null, lowestPriceAt: null, highestPrice: null, highestPriceAt: null,
      averagePrice: null, observationDays: 0, observationCount: 0,
      hasSufficientData: false, isAtLowest: false, currentBestPrice: null,
    }),
    siteUrl: "https://x.com",
  }) as Record<string, unknown>;
  check("expired price not published to search engines", ld.offers === undefined);
}
{
  check("boundary: exactly at TTL is fresh", classifyFreshness(hoursAgo(24), 24, NOW) === "fresh");
  check("boundary: one hour past TTL is stale", classifyFreshness(hoursAgo(25), 24, NOW) === "stale");
  check("boundary: past 3x TTL is expired", classifyFreshness(hoursAgo(73), 24, NOW) === "expired");
}
{
  // An alert must never fire on a price the site would not show.
  const candidate: AlertCandidate = {
    alertId: "a", userId: "u", productId: "p", productTitle: "T", productSlug: "t",
    targetPrice: 1000, currentPrice: 900, lastTriggeredAt: null, lastTriggeredPrice: null,
    notifyEmail: true, notifyPriceDrop: true,
  };
  check("alert fires on a valid price", decideTrigger(candidate, NOW).shouldTrigger);
  // Freshness filtering happens upstream in SQL; this asserts the rule
  // layer does not itself resurrect an above-target price.
  check("alert does not fire above target",
    !decideTrigger({ ...candidate, currentPrice: 1001 }, NOW).shouldTrigger);
}

console.log("Duplicate prevention");
{
  const base: AlertCandidate = {
    alertId: "a", userId: "u", productId: "p", productTitle: "T", productSlug: "t",
    targetPrice: 1000, currentPrice: 900, lastTriggeredAt: hoursAgo(48),
    lastTriggeredPrice: 900, notifyEmail: true, notifyPriceDrop: true,
  };
  check("same price does not re-notify", !decideTrigger(base, NOW).shouldTrigger);
  check("further drop does re-notify", decideTrigger({ ...base, currentPrice: 800 }, NOW).shouldTrigger);
  check("further drop inside cooldown suppressed",
    !decideTrigger({ ...base, currentPrice: 800, lastTriggeredAt: hoursAgo(1) }, NOW).shouldTrigger);
}
{
  // Variant duplicates: different storage must never share a variant row.
  const existing: MatchCandidate = {
    productId: "p1", title: "Phone", brand: "Acme",
    productKey: "acme phone",
    variants: [{ id: "v256", signature: "storage=256GB", axes: extractVariant({ title: "Phone 256GB" }).axes }],
  };
  const r = matchProduct({ externalId: "x", title: "Acme Phone 512GB", brand: "Acme" }, [existing]);
  check("512GB does not reuse the 256GB variant row", r.variantId !== "v256");
}
{
  // Delivery retries must not duplicate a completed send.
  check("sent delivery never retried",
    !isDueForRetry({ id: "d", channel: "email", status: "sent", attempts: 1,
      lastAttemptAt: null, nextAttemptAt: null, errorCode: null }, NOW));
  check("permanently failed never retried",
    !isDueForRetry({ id: "d", channel: "email", status: "permanently_failed", attempts: 2,
      lastAttemptAt: null, nextAttemptAt: null, errorCode: "hard_bounce" }, NOW));
}

console.log("Merchant sync: malformed feed data");
{
  check("empty feed item rejected", mapFlipkartProduct({} as FkProductInfo) === null);
  check("item with no price rejected", mapFlipkartProduct({
    productBaseInfoV1: {
      productId: "A", title: "T", productUrl: "https://x/p", imageUrls: null,
      maximumRetailPrice: null, flipkartSellingPrice: null, flipkartSpecialPrice: null,
      attributes: null, categoryPath: null, productBrand: null, productDescription: null,
      inStock: null, codAvailable: null, discountPercentage: null, offers: null,
      productFamily: null, styleCode: null,
    },
  } as unknown as FkProductInfo) === null);
}
{
  // One bad record must not be able to poison the catalog through
  // validation.
  const hostile = {
    externalId: "x", title: "a".repeat(5000), productUrl: "javascript:alert(1)",
    price: -5, currency: "USD", inStock: true, imageUrls: ["javascript:x"],
    variantAttributes: {}, specs: {}, isAvailable: true,
  };
  const parsed = normalizedProductSchema.safeParse(hostile);
  check("hostile feed record rejected by validation", !parsed.success);
}

console.log("Affiliate: degraded configuration never breaks the purchase");
{
  const dest = "https://shop.example.com/p/1";
  const cfg = (over: Partial<AffiliateConfig> = {}): AffiliateConfig => ({
    merchantId: "m", network: "n", strategy: "deep_link_template", isActive: true, ...over,
  });

  check("missing config falls back to the real merchant URL",
    buildAffiliateLink(dest, null).url === dest);
  check("broken template falls back rather than emitting a broken link",
    buildAffiliateLink(dest, cfg({ baseUrlTemplate: "https://t/{missing}?u={destination}", trackingId: "x" })).url === dest);
  check("inactive config still returns a working link",
    buildAffiliateLink(dest, cfg({ isActive: false })).url === dest);
  // The one case where we must NOT return a URL at all.
  check("unsafe destination yields no redirect target",
    buildAffiliateLink("javascript:alert(1)", cfg()).url === "");
}

console.log("Notification provider failures");
{
  const hard = classifyDeliveryResult({ ok: false, attempts: 1, errorCode: "hard_bounce" });
  check("hard bounce is never retried", hard.status === "permanently_failed" && hard.nextAttemptAt === null);

  const soft = classifyDeliveryResult({ ok: false, attempts: 1, httpStatus: 503, now: NOW });
  check("provider outage is retried", soft.status === "failed" && soft.nextAttemptAt !== null);

  const rateLimited = classifyDeliveryResult({ ok: false, attempts: 1, httpStatus: 429 });
  check("rate limit is retried despite being 4xx", rateLimited.status === "failed");
}

console.log("Pagination edge cases");
{
  const emptyClient = {
    rpc: async () => ({ data: [], error: null }),
    from: () => {
      const c: Record<string, unknown> = {};
      const self = () => c;
      Object.assign(c, { select: self, eq: self, order: self, limit: async () => ({ data: [], error: null }) });
      (c as { then?: unknown }).then = (r: (v: unknown) => void) => r({ data: [], error: null });
      return c;
    },
  } as never;

  const beyondEnd = await performSearch(emptyClient, { query: "x", page: 50 });
  check("page beyond results returns empty, not an error", beyondEnd.items.length === 0);
  check("totalPages is 0 when there are no results", beyondEnd.totalPages === 0);
  check("page number echoed back honestly", beyondEnd.page === 50);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
