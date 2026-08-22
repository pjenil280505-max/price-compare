/**
 * Structured data tests.
 *
 * The freshness cases matter most: publishing an expired price as current
 * structured data misleads searchers and violates Google's structured-data
 * policies, which can suppress rich results for the whole site.
 */
import {
  buildProductJsonLd, buildBreadcrumbJsonLd, buildItemListJsonLd,
  serializeJsonLd, type StructuredDataProduct,
} from "../lib/seo/structuredData.ts";
import type { MerchantPrice, ProductPricing } from "../lib/pricing/engine.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const SITE = "https://example.com";

function offer(over: Partial<MerchantPrice> = {}): MerchantPrice {
  return {
    offerId: "o1", merchantId: "m1", merchantName: "Store A", merchantSlug: "a",
    merchantLogoUrl: "", price: 19999, inStock: true, buyUrl: "/go/o1",
    lastCheckedAt: "2026-08-20T10:00:00Z", freshness: "fresh", isCheapest: true,
    ...over,
  };
}

function pricing(offers: MerchantPrice[]): ProductPricing {
  return {
    offers,
    bestOffer: offers[0] ?? null,
    lastUpdatedAt: offers[0]?.lastCheckedAt ?? null,
    allPricesExpired: offers.length > 0 && offers.every((o) => o.freshness === "expired"),
    statistics: {
      lowestPrice: null, lowestPriceAt: null, highestPrice: null, highestPriceAt: null,
      averagePrice: null, observationDays: 0, observationCount: 0,
      hasSufficientData: false, isAtLowest: false, currentBestPrice: null,
    },
  };
}

const PRODUCT: StructuredDataProduct = {
  title: "Test Phone 128GB",
  slug: "test-phone",
  description: "A phone.",
  brand: "TestBrand",
  imageUrls: ["https://cdn/1.jpg", "https://cdn/2.jpg"],
  rating: 4.4,
  reviewCount: 120,
};

console.log("Product JSON-LD basics");
{
  const ld = buildProductJsonLd({ product: PRODUCT, pricing: pricing([offer()]), siteUrl: SITE }) as Record<string, any>;
  check("is a Product", ld["@type"] === "Product");
  check("has canonical url", ld.url === `${SITE}/products/test-phone`);
  check("brand as Brand node", ld.brand?.["@type"] === "Brand");
  check("images included", Array.isArray(ld.image) && ld.image.length === 2);
  check("aggregate offer present", ld.offers?.["@type"] === "AggregateOffer");
  check("currency INR", ld.offers?.priceCurrency === "INR");
  check("rating included when reviews exist", ld.aggregateRating?.ratingValue === 4.4);
}
{
  // A rating with no reviews behind it is an invalid claim and is flagged
  // by structured-data validators.
  const ld = buildProductJsonLd({
    product: { ...PRODUCT, reviewCount: 0 }, pricing: pricing([offer()]), siteUrl: SITE,
  }) as Record<string, any>;
  check("no rating when reviewCount is 0", ld.aggregateRating === undefined, ld.aggregateRating);
}
{
  const ld = buildProductJsonLd({
    product: { ...PRODUCT, rating: undefined, reviewCount: undefined },
    pricing: pricing([offer()]), siteUrl: SITE,
  }) as Record<string, any>;
  check("no rating when absent", ld.aggregateRating === undefined);
}

console.log("THE FRESHNESS GATE — expired prices must never be published");
{
  const ld = buildProductJsonLd({
    product: PRODUCT,
    pricing: pricing([offer({ freshness: "expired", price: 9999 })]),
    siteUrl: SITE,
  }) as Record<string, any>;
  check("expired-only product emits NO offers", ld.offers === undefined, ld.offers);
  check("product node still emitted (still worth indexing)", ld["@type"] === "Product");
}
{
  const ld = buildProductJsonLd({
    product: PRODUCT,
    pricing: pricing([
      offer({ offerId: "fresh", price: 20000, freshness: "fresh" }),
      offer({ offerId: "expired", price: 5000, freshness: "expired" }),
    ]),
    siteUrl: SITE,
  }) as Record<string, any>;
  // The cheap expired price must not become lowPrice — that would advertise
  // a price nobody can actually get.
  check("expired price excluded from lowPrice", ld.offers.lowPrice === 20000, ld.offers.lowPrice);
  check("offerCount counts only publishable", ld.offers.offerCount === 1, ld.offers.offerCount);
}
{
  const ld = buildProductJsonLd({
    product: PRODUCT,
    pricing: pricing([offer({ freshness: "stale", price: 15000 })]),
    siteUrl: SITE,
  }) as Record<string, any>;
  // Stale is shown on-page with a caveat, so it may also be published.
  check("stale price IS published", ld.offers?.lowPrice === 15000, ld.offers);
}
{
  const ld = buildProductJsonLd({
    product: PRODUCT, pricing: pricing([offer({ price: null })]), siteUrl: SITE,
  }) as Record<string, any>;
  check("null price emits no offers", ld.offers === undefined);
}
{
  const ld = buildProductJsonLd({
    product: PRODUCT, pricing: pricing([offer({ price: 0 })]), siteUrl: SITE,
  }) as Record<string, any>;
  check("zero price emits no offers", ld.offers === undefined);
}

console.log("Availability + price range");
{
  const ld = buildProductJsonLd({
    product: PRODUCT,
    pricing: pricing([
      offer({ offerId: "a", price: 18000 }),
      offer({ offerId: "b", price: 22000 }),
    ]),
    siteUrl: SITE,
  }) as Record<string, any>;
  check("lowPrice correct", ld.offers.lowPrice === 18000);
  check("highPrice correct", ld.offers.highPrice === 22000);
  check("InStock when any offer in stock", ld.offers.availability.endsWith("InStock"));
}
{
  const ld = buildProductJsonLd({
    product: PRODUCT,
    pricing: pricing([offer({ inStock: false })]),
    siteUrl: SITE,
  }) as Record<string, any>;
  check("OutOfStock when none in stock", ld.offers.availability.endsWith("OutOfStock"));
}
{
  const ld = buildProductJsonLd({
    product: PRODUCT, pricing: pricing([offer()]), siteUrl: SITE,
  }) as Record<string, any>;
  const validUntil = ld.offers.offers[0].priceValidUntil;
  check("priceValidUntil is a date", /^\d{4}-\d{2}-\d{2}$/.test(validUntil), validUntil);
  check("priceValidUntil is after the check date", validUntil > "2026-08-20", validUntil);
}

console.log("Breadcrumbs and lists");
{
  const ld = buildBreadcrumbJsonLd([
    { name: "Home", url: SITE },
    { name: "Phones", url: `${SITE}/categories/phones` },
  ]) as Record<string, any>;
  check("BreadcrumbList type", ld["@type"] === "BreadcrumbList");
  check("positions are 1-indexed", ld.itemListElement[0].position === 1);
  check("all entries present", ld.itemListElement.length === 2);
}
{
  const ld = buildItemListJsonLd({
    name: "Phones", items: [{ title: "A", slug: "a" }, { title: "B", slug: "b" }], siteUrl: SITE,
  }) as Record<string, any>;
  check("ItemList counts correctly", ld.numberOfItems === 2);
  check("item urls built", ld.itemListElement[1].url === `${SITE}/products/b`);
}

console.log("Script injection escaping");
{
  const hostile = { ...PRODUCT, title: 'Phone </script><script>alert(1)</script>' };
  const serialized = serializeJsonLd(
    buildProductJsonLd({ product: hostile, pricing: pricing([offer()]), siteUrl: SITE }),
  );
  // A feed-supplied title containing </script> would otherwise terminate
  // the JSON-LD tag early and inject executable markup.
  check("no literal </script> survives", !serialized.includes("</script>"), serialized.slice(0, 120));
  check("< is escaped", serialized.includes("\\u003c"));
  check("still valid JSON", (() => { try { JSON.parse(serialized.replace(/\\u003c/g, "<")); return true; } catch { return false; } })());
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
