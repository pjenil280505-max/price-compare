import type { ProductPricing } from "@/lib/pricing/engine";

/**
 * SCHEMA.ORG STRUCTURED DATA
 *
 * The rule that governs this file: we publish a price to search engines
 * ONLY when we would show it as current on the page.
 *
 * This is not merely tidiness. Structured data is a public claim about
 * price and availability; emitting an expired price would misrepresent it
 * to users arriving from search, and Google's own structured-data policies
 * treat mismatched price/availability as a violation that can suppress
 * rich results entirely. So the same freshness rule the price engine
 * enforces on-page is enforced here.
 */

export interface StructuredDataProduct {
  title: string;
  slug: string;
  description?: string;
  brand?: string;
  imageUrls: string[];
  gtin?: string;
  mpn?: string;
  sku?: string;
  rating?: number;
  reviewCount?: number;
}

export interface BreadcrumbEntry {
  name: string;
  url: string;
}

type JsonLd = Record<string, unknown>;

/** schema.org availability values. */
const IN_STOCK = "https://schema.org/InStock";
const OUT_OF_STOCK = "https://schema.org/OutOfStock";

/**
 * Product + AggregateOffer JSON-LD.
 *
 * Returns the Product node WITHOUT any offers when there is no currently
 * valid price, rather than omitting the whole node — the product still
 * exists and is worth indexing; we just make no price claim about it.
 */
export function buildProductJsonLd(params: {
  product: StructuredDataProduct;
  pricing: ProductPricing;
  siteUrl: string;
}): JsonLd {
  const { product, pricing, siteUrl } = params;
  const productUrl = `${siteUrl}/products/${product.slug}`;

  const node: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    url: productUrl,
    "@id": `${productUrl}#product`,
  };

  if (product.description) node.description = product.description;
  if (product.imageUrls.length > 0) node.image = product.imageUrls.slice(0, 5);
  if (product.brand) node.brand = { "@type": "Brand", name: product.brand };
  if (product.gtin) node.gtin = product.gtin;
  if (product.mpn) node.mpn = product.mpn;
  if (product.sku) node.sku = product.sku;

  // Only claim a rating when there is a real review count behind it —
  // an AggregateRating with reviewCount 0 is an invalid structured-data
  // claim and is flagged by validators.
  if (product.rating != null && product.reviewCount != null && product.reviewCount > 0) {
    node.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(product.rating.toFixed(1)),
      reviewCount: product.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }

  // THE FRESHNESS GATE. Only offers we would present as current are
  // published. An expired price must never be asserted to a search engine.
  const publishable = pricing.offers.filter(
    (offer) => offer.price != null && offer.price > 0 && offer.freshness !== "expired",
  );

  if (publishable.length === 0) return node;

  const prices = publishable.map((o) => o.price as number);
  const low = Math.min(...prices);
  const high = Math.max(...prices);

  const offers = publishable.map((offer) => ({
    "@type": "Offer",
    price: offer.price,
    priceCurrency: "INR",
    availability: offer.inStock ? IN_STOCK : OUT_OF_STOCK,
    url: `${siteUrl}/products/${product.slug}`,
    seller: { "@type": "Organization", name: offer.merchantName },
    // Tells consumers how long this price may be relied on. Derived from
    // when we actually last verified it, not invented.
    priceValidUntil: priceValidUntil(offer.lastCheckedAt),
  }));

  node.offers = {
    "@type": "AggregateOffer",
    priceCurrency: "INR",
    lowPrice: low,
    highPrice: high,
    offerCount: publishable.length,
    availability: publishable.some((o) => o.inStock) ? IN_STOCK : OUT_OF_STOCK,
    offers,
  };

  return node;
}

/**
 * A conservative validity horizon: one week from the last verified check.
 * Long enough to be useful to consumers, short enough that we are not
 * asserting a price is good for months.
 */
function priceValidUntil(lastCheckedAt: string): string {
  const checked = new Date(lastCheckedAt).getTime();
  const base = Number.isFinite(checked) ? checked : Date.now();
  return new Date(base + 7 * 86_400_000).toISOString().slice(0, 10);
}

export function buildBreadcrumbJsonLd(entries: BreadcrumbEntry[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: entries.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: entry.url,
    })),
  };
}

export function buildItemListJsonLd(params: {
  name: string;
  items: { title: string; slug: string }[];
  siteUrl: string;
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: params.name,
    numberOfItems: params.items.length,
    itemListElement: params.items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.title,
      url: `${params.siteUrl}/products/${item.slug}`,
    })),
  };
}

export function buildOrganizationJsonLd(params: { siteUrl: string; name: string }): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: params.name,
    url: params.siteUrl,
    // Deliberately minimal: no logo, sameAs, or contact claims are made,
    // because asserting details we haven't verified is worse than omitting
    // them.
  };
}

/**
 * Serializes JSON-LD for embedding in a <script> tag.
 *
 * `<` is escaped because a product title from a merchant feed containing
 * "</script>" would otherwise terminate the tag early and inject markup.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
