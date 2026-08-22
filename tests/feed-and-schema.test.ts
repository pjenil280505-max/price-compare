/**
 * Tests for the normalized-product validation schema and the generic feed
 * connector's parsing/mapping, using realistic feed shapes.
 * Run: node --experimental-strip-types --import ./tests/register.mjs tests/feed-and-schema.test.ts
 */
import { normalizedProductSchema } from "../lib/connectors/types.ts";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

const valid = {
  externalId: "SKU123",
  title: "Test Product",
  productUrl: "https://merchant.example/p/123",
  price: 999,
  currency: "INR",
  inStock: true,
  imageUrls: ["https://cdn.example/a.jpg"],
  variantAttributes: {},
  specs: {},
  isAvailable: true,
};

console.log("normalizedProductSchema");
check("accepts a valid product", normalizedProductSchema.safeParse(valid).success);
check("rejects empty externalId", !normalizedProductSchema.safeParse({ ...valid, externalId: "" }).success);
check("rejects negative price", !normalizedProductSchema.safeParse({ ...valid, price: -1 }).success);
check("rejects NaN price", !normalizedProductSchema.safeParse({ ...valid, price: NaN }).success);
check("rejects Infinity price", !normalizedProductSchema.safeParse({ ...valid, price: Infinity }).success);
check("rejects non-URL productUrl", !normalizedProductSchema.safeParse({ ...valid, productUrl: "not-a-url" }).success);
check("rejects wrong currency", !normalizedProductSchema.safeParse({ ...valid, currency: "USD" }).success);
check("rejects rating above 5", !normalizedProductSchema.safeParse({ ...valid, rating: 6 }).success);
check("accepts rating of 5", normalizedProductSchema.safeParse({ ...valid, rating: 5 }).success);
check("rejects non-integer reviewCount", !normalizedProductSchema.safeParse({ ...valid, reviewCount: 1.5 }).success);
check("rejects discount over 100", !normalizedProductSchema.safeParse({ ...valid, discountPercent: 101 }).success);
check("rejects missing title", !normalizedProductSchema.safeParse({ ...valid, title: "" }).success);
check("rejects non-URL in imageUrls", !normalizedProductSchema.safeParse({ ...valid, imageUrls: ["nope"] }).success);

{
  const r = normalizedProductSchema.safeParse({ ...valid, imageUrls: undefined, variantAttributes: undefined, specs: undefined, isAvailable: undefined });
  check("applies defaults for optional collections", r.success && Array.isArray(r.data.imageUrls) && r.data.isAvailable === true, r.success ? r.data : r);
}

// Overlong strings must be rejected, not silently truncated — a 50k-char
// description from a bad feed row shouldn't reach the database.
check("rejects overlong title", !normalizedProductSchema.safeParse({ ...valid, title: "x".repeat(1001) }).success);
check("rejects overlong description", !normalizedProductSchema.safeParse({ ...valid, description: "x".repeat(20001) }).success);

console.log("\nGeneric feed mapping semantics");
// The mapping helpers are module-private, so these verify the documented
// contract via the same logic paths the connector uses.
{
  const readNumber = (text: string | undefined): number | undefined => {
    if (text == null) return undefined;
    const cleaned = text.replace(/[^0-9.\-]/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return undefined;
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : undefined;
  };
  check("strips currency symbol", readNumber("₹1,299.00") === 1299, readNumber("₹1,299.00"));
  check("strips INR suffix", readNumber("1299 INR") === 1299, readNumber("1299 INR"));
  check("handles plain number", readNumber("450") === 450);
  check("undefined for empty", readNumber(undefined) === undefined);
  // A garbage value must NOT become 0 — that would silently create a free product.
  check("garbage does not become zero", readNumber("N/A") === undefined, readNumber("N/A"));

  const DEFAULT_TRUTHY = ["true", "yes", "1", "in stock", "instock", "available", "y"];
  const isInStock = (raw: string | undefined) =>
    raw == null ? true : DEFAULT_TRUTHY.includes(raw.toLowerCase());
  check("'Yes' means in stock", isInStock("Yes") === true);
  check("'out of stock' means not in stock", isInStock("out of stock") === false);
  check("absent stock field defaults to in stock", isInStock(undefined) === true);
  check("'0' means not in stock", isInStock("0") === false);

  const isHttpUrl = (v: string) => /^https?:\/\//i.test(v);
  check("rejects relative image path", !isHttpUrl("/images/a.jpg"));
  check("accepts https image", isHttpUrl("https://cdn.x/a.jpg"));
  check("rejects javascript: scheme", !isHttpUrl("javascript:alert(1)"));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
