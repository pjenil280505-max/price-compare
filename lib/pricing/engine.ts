/**
 * Price engine — types and pure logic.
 *
 * The freshness rules here MIRROR public.price_freshness() in
 * 0012_price_engine.sql. SQL is authoritative (it's what the API returns);
 * these exist so the client can re-derive freshness as time passes on an
 * already-loaded page, and so the rules are unit-testable without a
 * database. If you change one, change both — the tests assert they agree.
 */

export type Freshness = "fresh" | "stale" | "expired";

export interface MerchantPrice {
  offerId: string;
  merchantId: string;
  merchantName: string;
  merchantSlug: string;
  merchantLogoUrl: string;
  /** Null when the merchant lists the product but publishes no usable price. */
  price: number | null;
  mrp?: number;
  discountPercent?: number;
  inStock: boolean;
  codAvailable?: boolean;
  rating?: number;
  reviewCount?: number;
  buyUrl: string;
  lastCheckedAt: string;
  freshness: Freshness;
  /** Previous distinct price, when history has one. */
  previousPrice?: number;
  priceChange?: number;
  priceChangePercent?: number;
  isCheapest: boolean;
  /** Rupees above the best eligible price. 0 for the cheapest. */
  differenceFromBest?: number;
}

export interface PriceStatistics {
  lowestPrice: number | null;
  lowestPriceAt: string | null;
  highestPrice: number | null;
  highestPriceAt: string | null;
  averagePrice: number | null;
  observationDays: number;
  observationCount: number;
  /**
   * False until there's a real observation window. The UI must NOT render
   * "lowest recorded price" when this is false — claiming an all-time low
   * from three data points is misleading.
   */
  hasSufficientData: boolean;
  isAtLowest: boolean;
  currentBestPrice: number | null;
}

export interface ProductPricing {
  offers: MerchantPrice[];
  statistics: PriceStatistics;
  /** The cheapest eligible offer, or null when nothing is currently usable. */
  bestOffer: MerchantPrice | null;
  /** Most recent successful check across all offers — the page's "as of" time. */
  lastUpdatedAt: string | null;
  /** True when every offer is expired: we must say so rather than show a price. */
  allPricesExpired: boolean;
}

/** Minimums that must hold before historical claims may be shown. */
export const SUFFICIENT_OBSERVATION_DAYS = 7;
export const SUFFICIENT_OBSERVATION_COUNT = 5;

/**
 * Mirrors public.price_freshness(). Beyond ttl the price is stale; beyond
 * 3x ttl it's expired and may never be presented as current.
 */
export function classifyFreshness(lastCheckedAt: string | null, ttlHours: number, now: Date = new Date()): Freshness {
  if (!lastCheckedAt) return "expired";
  const checkedMs = new Date(lastCheckedAt).getTime();
  if (!Number.isFinite(checkedMs)) return "expired";

  const ageHours = (now.getTime() - checkedMs) / 3_600_000;
  if (ageHours < 0) return "fresh"; // clock skew — don't punish the merchant
  if (ageHours <= ttlHours) return "fresh";
  if (ageHours <= ttlHours * 3) return "stale";
  return "expired";
}

/**
 * Whether an offer may compete to be "the best price".
 * Requires: a real price, in stock, and not expired. This single predicate
 * is what keeps stale data out of the headline number.
 */
export function isEligibleForBestPrice(offer: MerchantPrice): boolean {
  return offer.price != null && offer.price > 0 && offer.inStock && offer.freshness !== "expired";
}

/** Cheapest eligible offer, or null when none qualify. */
export function selectBestOffer(offers: MerchantPrice[]): MerchantPrice | null {
  const eligible = offers.filter(isEligibleForBestPrice);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, o) => ((o.price as number) < (best.price as number) ? o : best));
}

export interface PriceChange {
  amount: number;
  percent: number;
  direction: "up" | "down";
}

/** Change from previous to current. Returns null when unchanged or unknowable. */
export function computePriceChange(current: number | null, previous: number | null | undefined): PriceChange | null {
  if (current == null || previous == null || previous <= 0) return null;
  const amount = current - previous;
  if (amount === 0) return null;
  return {
    amount: Math.abs(amount),
    percent: Math.abs((amount / previous) * 100),
    direction: amount < 0 ? "down" : "up",
  };
}

/** Discount vs MRP. Only derived when MRP genuinely exceeds the price. */
export function computeDiscountPercent(price: number | null, mrp: number | null | undefined): number | null {
  if (price == null || mrp == null || mrp <= price || mrp <= 0) return null;
  return Math.round(((mrp - price) / mrp) * 100);
}

/** Rupees above the best price. Null when there's no eligible best. */
export function differenceFromBest(offer: MerchantPrice, bestPrice: number | null): number | null {
  if (bestPrice == null || offer.price == null) return null;
  return offer.price - bestPrice;
}

/**
 * Human-readable age, used for the mandatory staleness label. Deliberately
 * blunt: "checked 4 days ago" is more honest than a relative-time phrase
 * that reads like it might be recent.
 */
export function describeAge(lastCheckedAt: string | null, now: Date = new Date()): string {
  if (!lastCheckedAt) return "never checked";
  const ms = now.getTime() - new Date(lastCheckedAt).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/**
 * The sentence the UI shows about a price's currency. Never returns
 * language implying an expired price is current.
 */
export function freshnessLabel(offer: MerchantPrice, now: Date = new Date()): string {
  const age = describeAge(offer.lastCheckedAt, now);
  switch (offer.freshness) {
    case "fresh":
      return `Updated ${age}`;
    case "stale":
      return `Last checked ${age} — may have changed`;
    case "expired":
      return `Not verified since ${age} — price may be out of date`;
  }
}

export function hasSufficientHistory(stats: PriceStatistics): boolean {
  return (
    stats.hasSufficientData &&
    stats.observationDays >= SUFFICIENT_OBSERVATION_DAYS &&
    stats.observationCount >= SUFFICIENT_OBSERVATION_COUNT &&
    stats.lowestPrice != null
  );
}

/** Assembles the product-page payload from raw offer rows + statistics. */
export function buildProductPricing(offers: MerchantPrice[], statistics: PriceStatistics): ProductPricing {
  const bestOffer = selectBestOffer(offers);

  const checkTimes = offers
    .map((o) => new Date(o.lastCheckedAt).getTime())
    .filter((t) => Number.isFinite(t));

  const lastUpdatedAt = checkTimes.length > 0 ? new Date(Math.max(...checkTimes)).toISOString() : null;

  return {
    offers,
    statistics,
    bestOffer,
    lastUpdatedAt,
    allPricesExpired: offers.length > 0 && offers.every((o) => o.freshness === "expired"),
  };
}
