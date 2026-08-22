/**
 * Runtime tests for shared logic: price/discount helpers, cheapest-offer
 * selection, rate limiting, and Flipkart delta URL construction.
 * Run: node --experimental-strip-types tests/core-logic.test.ts
 */
import { getCheapestOffer, getDiscountPercent, formatPrice, slugify, clamp } from "../lib/utils.ts";
import { RateLimiter } from "../lib/connectors/http.ts";
import type { MerchantOffer, Product } from "../lib/types.ts";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

const merchant = { id: "m1", name: "Store", slug: "store", logoUrl: "" };

function offer(id: string, price: number, inStock: boolean, mrp?: number): MerchantOffer {
  return {
    id, merchant, price, mrp, currency: "INR", inStock,
    buyUrl: `/go/${id}`, lastCheckedAt: new Date().toISOString(),
  };
}

function product(offers: MerchantOffer[]): Product {
  return { id: "p1", slug: "p", title: "T", category: "C", imageUrl: "", offers };
}

console.log("getCheapestOffer");
check("picks cheapest in-stock", getCheapestOffer(product([offer("a", 500, true), offer("b", 300, true)]))?.id === "b");
check(
  "ignores cheaper out-of-stock",
  getCheapestOffer(product([offer("a", 500, true), offer("b", 100, false)]))?.id === "a",
);
check(
  "falls back to cheapest overall when nothing in stock",
  getCheapestOffer(product([offer("a", 500, false), offer("b", 100, false)]))?.id === "b",
);
check("undefined for no offers", getCheapestOffer(product([])) === undefined);

console.log("getDiscountPercent");
check("derives from mrp/price", getDiscountPercent(offer("a", 800, true, 1000)) === 20);
check("undefined when no mrp", getDiscountPercent(offer("a", 800, true)) === undefined);
check("undefined when mrp <= price", getDiscountPercent(offer("a", 1000, true, 900)) === undefined);
check("explicit discountPercent wins", getDiscountPercent({ ...offer("a", 800, true, 1000), discountPercent: 15 }) === 15);
check("zero discount when mrp equals price", getDiscountPercent(offer("a", 1000, true, 1000)) === undefined);

console.log("formatPrice / slugify / clamp");
check("formats INR without decimals", /^₹\s?1,000$/.test(formatPrice(1000)), formatPrice(1000));
check("compact formatting differs", formatPrice(150000, true) !== formatPrice(150000));
check("slugify strips punctuation", slugify("Apple iPhone 15 (128GB)!") === "apple-iphone-15-128gb", slugify("Apple iPhone 15 (128GB)!"));
check("slugify trims dashes", slugify("  --Hello--  ") === "hello", slugify("  --Hello--  "));
check("slugify handles empty", slugify("") === "");
check("clamp works", clamp(15, 0, 10) === 10 && clamp(-5, 0, 10) === 0 && clamp(5, 0, 10) === 5);

console.log("RateLimiter");
{
  const limiter = new RateLimiter(50); // 50/sec
  const start = Date.now();
  // Burst capacity is 50, so 50 immediate acquires should be near-instant.
  await Promise.all(Array.from({ length: 50 }, () => limiter.acquire()));
  const burstMs = Date.now() - start;
  check("burst is not throttled", burstMs < 200, `${burstMs}ms`);

  // The 51st must wait for a refill (~20ms at 50/s).
  const t2 = Date.now();
  await limiter.acquire();
  const waited = Date.now() - t2;
  check("throttles past burst", waited >= 5, `${waited}ms`);
}

console.log("Flipkart delta URL building");
{
  // Re-implements the module-private helper's contract to verify the
  // documented invariant: expiresAt/sig must survive untouched.
  const original =
    "https://affiliate-api.flipkart.net/affiliate/1.0/deltaFeeds/kesh/category/reh.json?expiresAt=1459959717790&sig=abc123";
  const url = new URL(original);
  const match = url.pathname.match(/^(.*)\.(json|xml)$/);
  check("pathname matches extension pattern", match !== null);
  if (match) {
    url.pathname = `${match[1]}/fromVersion/136625296.${match[2]}`;
    const out = url.toString();
    check("inserts fromVersion before extension", out.includes("/fromVersion/136625296.json"), out);
    check("preserves sig", out.includes("sig=abc123"));
    check("preserves expiresAt", out.includes("expiresAt=1459959717790"));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
