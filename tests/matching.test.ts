/**
 * Matching tests. The variant-safety cases are the important ones: if any
 * of those regress, the system silently merges different physical products.
 */
import {
  extractVariant, buildVariantSignature, buildVariantLabel,
  findVariantConflicts, hasHardVariantConflict,
} from "../lib/matching/variant.ts";
import {
  normalizeGtin, normalizeBrand, normalizeIdentifier, buildProductKey, normalizeText,
} from "../lib/matching/normalize.ts";
import { matchProduct, fingerprint, type MatchCandidate } from "../lib/matching/matcher.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

console.log("GTIN validation (check digit)");
check("valid EAN-13 accepted", normalizeGtin("5901234123457") !== undefined);
check("invalid check digit rejected", normalizeGtin("5901234123458") === undefined);
check("valid UPC-A accepted", normalizeGtin("036000291452") !== undefined);
check("UPC-A and EAN-13 of same product normalize equal",
  normalizeGtin("036000291452") === normalizeGtin("0036000291452"),
  [normalizeGtin("036000291452"), normalizeGtin("0036000291452")]);
check("all-zeros placeholder rejected", normalizeGtin("0000000000000") === undefined);
check("wrong length rejected", normalizeGtin("12345") === undefined);
check("hyphenated form accepted", normalizeGtin("59-01234-123457") !== undefined);

console.log("Identifier + brand normalization");
check("MPN punctuation ignored", normalizeIdentifier("MQ8Y3HN/A") === normalizeIdentifier("mq8y3hn-a"));
check("short numeric rejected as MPN", normalizeIdentifier("128") === undefined);
check("placeholder rejected", normalizeIdentifier("N/A") === undefined);
check("brand alias mapped", normalizeBrand("Hewlett Packard") === "hp");
check("brand spacing collapsed", normalizeBrand("One Plus") === "oneplus");
check("unknown brand passes through", normalizeBrand("Zebronics") === "zebronics");

console.log("Variant extraction");
{
  const v = extractVariant({ title: "Apple iPhone 15 Pro 256GB Midnight Black" });
  check("storage extracted", v.axes.storage === "256GB", v.axes);
  check("colour extracted", v.axes.color === "black", v.axes);
}
{
  const v = extractVariant({ title: "Samsung Galaxy M34 8GB RAM 128GB Storage Blue" });
  check("RAM separated from storage", v.axes.ram === "8GB" && v.axes.storage === "128GB", v.axes);
}
{
  const v = extractVariant({ title: "Laptop with 1TB SSD" });
  check("TB normalized", v.axes.storage === "1TB", v.axes);
}
{
  const a = extractVariant({ title: "X 1024GB" });
  const b = extractVariant({ title: "X 1TB" });
  check("1024GB === 1TB canonically", a.axes.storage === b.axes.storage, [a.axes, b.axes]);
}
{
  const v = extractVariant({ title: "Sony Bravia 55 inch 4K TV" });
  check("screen size extracted", v.axes.screen === "55IN", v.axes);
}
{
  const v = extractVariant({ title: "Protein Powder 1kg Chocolate" });
  check("weight canonicalized to grams", v.axes.capacity === "1000G", v.axes);
}
{
  const v = extractVariant({ title: "Shampoo 500ml" });
  const w = extractVariant({ title: "Shampoo 0.5L" });
  check("500ml === 0.5L", v.axes.capacity === w.axes.capacity, [v.axes, w.axes]);
}
{
  const v = extractVariant({ title: "Socks Pack of 3" });
  check("pack count extracted", v.axes.count === "x3", v.axes);
}
{
  const v = extractVariant({ title: "Generic USB Cable" });
  check("no axes -> empty signature", buildVariantSignature(v.axes) === "", v.axes);
  check("empty signature labels as Standard", buildVariantLabel(v.axes) === "Standard");
}
{
  // Explicit attributes must beat title parsing.
  const v = extractVariant({ title: "Phone 128GB", attributes: { storage: "256 GB", color: "Blue" } });
  check("explicit attribute wins over title", v.axes.storage === "256GB", v.axes);
}

console.log("Variant conflicts");
{
  const a = extractVariant({ title: "iPhone 15 256GB" }).axes;
  const b = extractVariant({ title: "iPhone 15 512GB" }).axes;
  check("256 vs 512 is a HARD conflict", hasHardVariantConflict(a, b));
  check("conflict names the axis", findVariantConflicts(a, b)[0]?.axis === "storage");
}
{
  const a = extractVariant({ title: "iPhone 15 Black" }).axes;
  const b = extractVariant({ title: "iPhone 15 Blue" }).axes;
  check("colour difference is SOFT, not hard", !hasHardVariantConflict(a, b));
}
{
  const a = extractVariant({ title: "iPhone 15 256GB" }).axes;
  const b = extractVariant({ title: "iPhone 15" }).axes;
  check("missing axis is NOT a conflict", findVariantConflicts(a, b).length === 0, [a, b]);
}
{
  const a = extractVariant({ title: "TV 55 inch" }).axes;
  const b = extractVariant({ title: "TV 65 inch" }).axes;
  check("screen size difference is hard", hasHardVariantConflict(a, b));
}

console.log("Product key separates identity from variant");
{
  const k1 = buildProductKey({ title: "Apple iPhone 15 256GB Black", brand: "Apple",
    variantTokens: extractVariant({ title: "Apple iPhone 15 256GB Black" }).tokens });
  const k2 = buildProductKey({ title: "Apple iPhone 15 512GB Blue", brand: "Apple",
    variantTokens: extractVariant({ title: "Apple iPhone 15 512GB Blue" }).tokens });
  check("same product key across variants", k1 === k2, [k1, k2]);
  check("product key has no storage token", !k1.includes("256") && !k1.includes("512"), k1);
}
{
  const k = buildProductKey({ title: "Brand New Latest Sony WH-1000XM5 (2024 Model) Free Shipping",
    brand: "Sony", variantTokens: [] });
  check("marketing noise stripped", !k.includes("brand new") && !k.includes("free shipping") && !k.includes("2024"), k);
}

console.log("Matcher — the critical safety cases");
function candidate(over: Partial<MatchCandidate> = {}): MatchCandidate {
  const base: MatchCandidate = {
    productId: "prod-1",
    title: "Apple iPhone 15",
    brand: "Apple",
    productKey: buildProductKey({ title: "Apple iPhone 15", brand: "Apple", variantTokens: [] }),
    variants: [],
  };
  return { ...base, ...over };
}

{
  // THE headline requirement.
  const existing = candidate({
    variants: [{ id: "v256", signature: "storage=256GB",
      axes: extractVariant({ title: "iPhone 15 256GB" }).axes }],
  });
  const r = matchProduct({ externalId: "x", title: "Apple iPhone 15 512GB", brand: "Apple" }, [existing]);
  check("512GB does NOT reuse the 256GB variant", r.variantId !== "v256", r.variantId);
  check("512GB still attaches to the same product", r.productId === "prod-1", r.productId);
}
{
  const existing = candidate({
    variants: [{ id: "v256", signature: "storage=256GB",
      axes: extractVariant({ title: "iPhone 15 256GB" }).axes }],
  });
  const r = matchProduct({ externalId: "x", title: "Apple iPhone 15 256GB", brand: "Apple" }, [existing]);
  check("identical variant reuses the variant row", r.variantId === "v256", r.variantId);
}
{
  // GTIN is authoritative but must still respect a hard variant conflict.
  const existing = candidate({
    gtin: "5901234123457",
    variants: [{ id: "v256", signature: "storage=256GB",
      axes: extractVariant({ title: "iPhone 15 256GB" }).axes }],
  });
  const r = matchProduct(
    { externalId: "x", title: "Apple iPhone 15 512GB", brand: "Apple", gtin: "5901234123457" },
    [existing],
  );
  check("GTIN match uses gtin tier", r.tier === "gtin", r.tier);
  check("GTIN + different storage -> NOT the 256GB variant", r.variantId !== "v256");
}
{
  // Different brands, near-identical titles — a real marketplace hazard.
  const existing = candidate({ brand: "Apple", title: "Apple Wireless Earbuds" });
  const r = matchProduct(
    { externalId: "x", title: "Zebronics Wireless Earbuds", brand: "Zebronics" }, [existing],
  );
  check("brand mismatch blocks the match", r.decision === "create_new", r);
}
{
  const existing = candidate({ gtin: "5901234123457", brand: "Apple" });
  const r = matchProduct(
    { externalId: "x", title: "iPhone 15", brand: "Appel Inc", gtin: "5901234123457" }, [existing],
  );
  check("GTIN survives a brand typo", r.tier === "gtin" && r.productId === "prod-1", r.tier);
}
{
  const r = matchProduct({ externalId: "x", title: "Totally Unknown Item", brand: "Nobody" }, []);
  check("no candidates -> create_new", r.decision === "create_new" && r.productId === null);
}
{
  const existing = candidate({ mpn: "MQ8Y3HN/A" });
  const r = matchProduct({ externalId: "x", title: "iPhone 15", brand: "Apple", mpn: "mq8y3hn-a" }, [existing]);
  check("MPN tier matches across punctuation", r.tier === "mpn", r.tier);
}
{
  const existing = candidate({ title: "Sony WH-1000XM5 Headphones", brand: "Sony",
    productKey: buildProductKey({ title: "Sony WH-1000XM5 Headphones", brand: "Sony", variantTokens: [] }) });
  const r = matchProduct({ externalId: "x", title: "Sony WH-1000XM5 Headphones", brand: "Sony" }, [existing]);
  check("identical product key auto-merges", r.decision === "auto_merge" || r.confidence >= 0.75, r);
}
{
  // Low similarity must not merge.
  const existing = candidate({ title: "Apple iPhone 15", brand: "Apple" });
  const r = matchProduct({ externalId: "x", title: "Apple MacBook Air M3", brand: "Apple" }, [existing]);
  check("unrelated products in same brand -> create_new", r.decision === "create_new", r);
}
{
  const fp = fingerprint({ externalId: "x", title: "Samsung Galaxy S24 12GB RAM 512GB Titanium Gray", brand: "Samsung" });
  check("fingerprint captures ram", fp.axes.ram === "12GB", fp.axes);
  check("fingerprint captures storage", fp.axes.storage === "512GB", fp.axes);
  check("signature is deterministic + sorted", fp.variantSignature.startsWith("color="), fp.variantSignature);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
