/**
 * Price engine tests. The staleness cases matter most: a regression there
 * means the site presents old prices as current, which is the single most
 * damaging thing a price-comparison site can do.
 */
import {
  classifyFreshness, isEligibleForBestPrice, selectBestOffer, computePriceChange,
  computeDiscountPercent, differenceFromBest, describeAge, freshnessLabel,
  hasSufficientHistory, buildProductPricing,
  type MerchantPrice, type PriceStatistics,
} from "../lib/pricing/engine.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const NOW = new Date("2026-08-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function offer(over: Partial<MerchantPrice> = {}): MerchantPrice {
  return {
    offerId: "o1", merchantId: "m1", merchantName: "Store A", merchantSlug: "a",
    merchantLogoUrl: "", price: 1000, inStock: true, buyUrl: "/go/o1",
    lastCheckedAt: hoursAgo(1), freshness: "fresh", isCheapest: false,
    ...over,
  };
}

console.log("Freshness classification (TTL = 24h)");
check("1h old -> fresh", classifyFreshness(hoursAgo(1), 24, NOW) === "fresh");
check("exactly at TTL -> fresh", classifyFreshness(hoursAgo(24), 24, NOW) === "fresh");
check("just past TTL -> stale", classifyFreshness(hoursAgo(25), 24, NOW) === "stale");
check("2x TTL -> stale", classifyFreshness(hoursAgo(48), 24, NOW) === "stale");
check("just past 3x TTL -> expired", classifyFreshness(hoursAgo(73), 24, NOW) === "expired");
check("2 weeks -> expired", classifyFreshness(hoursAgo(336), 24, NOW) === "expired");
check("null -> expired", classifyFreshness(null, 24, NOW) === "expired");
check("garbage timestamp -> expired", classifyFreshness("not-a-date", 24, NOW) === "expired");
check("future timestamp (clock skew) -> fresh", classifyFreshness(hoursAgo(-5), 24, NOW) === "fresh");
check("short TTL merchant stales sooner", classifyFreshness(hoursAgo(10), 6, NOW) === "stale");

console.log("Eligibility — the anti-stale guard");
check("fresh in-stock is eligible", isEligibleForBestPrice(offer()));
check("EXPIRED is NOT eligible", !isEligibleForBestPrice(offer({ freshness: "expired" })));
check("stale IS eligible (best we have, labelled)", isEligibleForBestPrice(offer({ freshness: "stale" })));
check("out of stock is NOT eligible", !isEligibleForBestPrice(offer({ inStock: false })));
check("null price is NOT eligible", !isEligibleForBestPrice(offer({ price: null })));
check("zero price is NOT eligible", !isEligibleForBestPrice(offer({ price: 0 })));

console.log("Cheapest merchant selection");
{
  const offers = [
    offer({ offerId: "a", price: 1200 }),
    offer({ offerId: "b", price: 900 }),
    offer({ offerId: "c", price: 1100 }),
  ];
  check("picks lowest", selectBestOffer(offers)?.offerId === "b");
}
{
  // THE critical case: a cheaper price that is expired must not win.
  const offers = [
    offer({ offerId: "fresh", price: 1200, freshness: "fresh" }),
    offer({ offerId: "expired", price: 700, freshness: "expired" }),
  ];
  check("expired cheaper price does NOT become best", selectBestOffer(offers)?.offerId === "fresh",
    selectBestOffer(offers)?.offerId);
}
{
  const offers = [
    offer({ offerId: "instock", price: 1200 }),
    offer({ offerId: "oos", price: 800, inStock: false }),
  ];
  check("out-of-stock cheaper price does NOT become best", selectBestOffer(offers)?.offerId === "instock");
}
{
  const offers = [offer({ freshness: "expired" }), offer({ offerId: "b", freshness: "expired" })];
  check("all expired -> no best offer at all", selectBestOffer(offers) === null);
}
{
  check("no offers -> null", selectBestOffer([]) === null);
}
{
  const offers = [offer({ offerId: "a", price: null }), offer({ offerId: "b", price: 500 })];
  check("missing price skipped, next wins", selectBestOffer(offers)?.offerId === "b");
}

console.log("Price change detection");
{
  const drop = computePriceChange(900, 1000);
  check("decrease detected", drop?.direction === "down" && drop.amount === 100);
  check("decrease percent correct", Math.abs((drop?.percent ?? 0) - 10) < 0.001, drop?.percent);
}
{
  const rise = computePriceChange(1200, 1000);
  check("increase detected", rise?.direction === "up" && rise.amount === 200);
  check("increase percent correct", Math.abs((rise?.percent ?? 0) - 20) < 0.001, rise?.percent);
}
check("unchanged -> null", computePriceChange(1000, 1000) === null);
check("no previous -> null", computePriceChange(1000, null) === null);
check("null current -> null", computePriceChange(null, 1000) === null);
check("zero previous -> null (no divide by zero)", computePriceChange(1000, 0) === null);

console.log("Discount derivation");
check("derives discount", computeDiscountPercent(800, 1000) === 20);
check("no MRP -> null", computeDiscountPercent(800, null) === null);
check("MRP below price -> null (no fake discount)", computeDiscountPercent(1000, 900) === null);
check("MRP equals price -> null", computeDiscountPercent(1000, 1000) === null);
check("zero MRP -> null", computeDiscountPercent(800, 0) === null);

console.log("Difference from best");
check("difference computed", differenceFromBest(offer({ price: 1200 }), 900) === 300);
check("cheapest has zero difference", differenceFromBest(offer({ price: 900 }), 900) === 0);
check("null when no best", differenceFromBest(offer({ price: 1200 }), null) === null);
check("null price -> null", differenceFromBest(offer({ price: null }), 900) === null);

console.log("Sufficiency guard for historical claims");
function stats(over: Partial<PriceStatistics> = {}): PriceStatistics {
  return {
    lowestPrice: 800, lowestPriceAt: hoursAgo(500), highestPrice: 1300, highestPriceAt: hoursAgo(900),
    averagePrice: 1000, observationDays: 30, observationCount: 60,
    hasSufficientData: true, isAtLowest: false, currentBestPrice: 900,
    ...over,
  };
}
check("rich history qualifies", hasSufficientHistory(stats()));
check("too few days rejected", !hasSufficientHistory(stats({ observationDays: 3, hasSufficientData: false })));
check("too few observations rejected", !hasSufficientHistory(stats({ observationCount: 2, hasSufficientData: false })));
check("no lowest price rejected", !hasSufficientHistory(stats({ lowestPrice: null })));
check("brand new product rejected",
  !hasSufficientHistory(stats({ observationDays: 1, observationCount: 1, hasSufficientData: false })));

console.log("Freshness labelling never implies currency");
check("fresh says Updated", freshnessLabel(offer({ lastCheckedAt: hoursAgo(2) }), NOW).startsWith("Updated"));
{
  const label = freshnessLabel(offer({ freshness: "stale", lastCheckedAt: hoursAgo(30) }), NOW);
  check("stale warns it may have changed", label.includes("may have changed"), label);
}
{
  const label = freshnessLabel(offer({ freshness: "expired", lastCheckedAt: hoursAgo(400) }), NOW);
  check("expired says out of date", label.includes("out of date"), label);
  check("expired never says 'Updated'", !label.startsWith("Updated"), label);
}
check("age in days", describeAge(hoursAgo(48), NOW) === "2 days ago", describeAge(hoursAgo(48), NOW));
check("age in hours", describeAge(hoursAgo(3), NOW) === "3 hours ago");
check("never checked", describeAge(null, NOW) === "never checked");

console.log("Full product pricing assembly");
{
  const offers = [
    offer({ offerId: "a", price: 1200, lastCheckedAt: hoursAgo(1) }),
    offer({ offerId: "b", price: 950, lastCheckedAt: hoursAgo(5) }),
    offer({ offerId: "c", price: 700, freshness: "expired", lastCheckedAt: hoursAgo(400) }),
  ];
  const p = buildProductPricing(offers, stats());
  check("best offer excludes expired", p.bestOffer?.offerId === "b", p.bestOffer?.offerId);
  check("lastUpdatedAt is the most recent check", p.lastUpdatedAt === hoursAgo(1), p.lastUpdatedAt);
  check("not all expired", p.allPricesExpired === false);
}
{
  const offers = [
    offer({ offerId: "a", freshness: "expired", lastCheckedAt: hoursAgo(300) }),
    offer({ offerId: "b", freshness: "expired", lastCheckedAt: hoursAgo(400) }),
  ];
  const p = buildProductPricing(offers, stats({ hasSufficientData: false }));
  check("all-expired flagged", p.allPricesExpired === true);
  check("all-expired yields no best offer", p.bestOffer === null);
}
{
  // Merchant unavailable entirely (no offers at all).
  const p = buildProductPricing([], stats({ lowestPrice: null, hasSufficientData: false }));
  check("no offers -> no best, not flagged as expired", p.bestOffer === null && p.allPricesExpired === false);
  check("no offers -> null lastUpdatedAt", p.lastUpdatedAt === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
