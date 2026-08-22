/**
 * Query parser tests, driven by the example queries this system must
 * support, plus the edge cases that would silently hide results.
 */
import { parseSearchQuery, parseAmount, isFilterOnlyQuery } from "../lib/search/queryParser.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

console.log("Amount parsing (Indian shorthand)");
check("plain number", parseAmount("60000") === 60000);
check("comma separated", parseAmount("60,000") === 60000);
check("rupee symbol", parseAmount("₹60,000") === 60000);
check("rs prefix", parseAmount("Rs. 25000") === 25000, parseAmount("Rs. 25000"));
check("k shorthand", parseAmount("30k") === 30000);
check("lakh", parseAmount("1 lakh") === 100000);
check("decimal lakh", parseAmount("1.5 lakh") === 150000);
check("lac spelling", parseAmount("2 lac") === 200000);
check("crore", parseAmount("1 crore") === 10000000);
check("unknown suffix -> null (never guess)", parseAmount("60000 xyz") === null);
check("zero rejected", parseAmount("0") === null);
check("garbage rejected", parseAmount("abc") === null);

console.log("Required example queries");
{
  const q = parseSearchQuery("iPhone 16");
  check("iPhone 16 -> text preserved", q.text === "iphone 16", q.text);
  check("iPhone 16 -> no price filter", q.maxPrice === undefined);
  check("iPhone 16 -> no variant filter (16 is a model, not a spec)",
    Object.keys(q.variantAxes).length === 0, q.variantAxes);
}
{
  const q = parseSearchQuery("Samsung S25 Ultra");
  check("Samsung S25 Ultra -> text intact", q.text === "samsung s25 ultra", q.text);
  check("no spurious filters", Object.keys(q.variantAxes).length === 0 && q.maxPrice === undefined);
}
{
  const q = parseSearchQuery("gaming laptop under ₹60,000");
  check("maxPrice extracted", q.maxPrice === 60000, q.maxPrice);
  check("price phrase removed from text", !q.text.includes("60") && !q.text.includes("under"), q.text);
  check("subject retained", q.text.includes("gaming") && q.text.includes("laptop"), q.text);
  check("hint generated", q.appliedHints.some((h) => h.includes("Under")), q.appliedHints);
}
{
  const q = parseSearchQuery("best phone");
  check("best -> rating sort", q.impliedSort === "rating", q.impliedSort);
  check("subject retained", q.text === "phone", q.text);
}
{
  const q = parseSearchQuery("OnePlus phone");
  check("brand left in text for FTS (no invented brand list)", q.text === "oneplus phone", q.text);
}
{
  const q = parseSearchQuery("16GB RAM laptop");
  check("ram axis extracted", q.variantAxes.ram === "16GB", q.variantAxes);
  check("spec removed from text", !q.text.includes("16"), q.text);
  check("subject retained", q.text.includes("laptop"), q.text);
}
{
  const q = parseSearchQuery("phone under ₹30,000");
  check("maxPrice 30000", q.maxPrice === 30000, q.maxPrice);
  check("text is phone", q.text === "phone", q.text);
}

console.log("Price phrasing variants");
check("under", parseSearchQuery("laptop under 50000").maxPrice === 50000);
check("below", parseSearchQuery("laptop below 50000").maxPrice === 50000);
check("less than", parseSearchQuery("laptop less than 50000").maxPrice === 50000);
check("upto", parseSearchQuery("laptop upto 50000").maxPrice === 50000);
check("within", parseSearchQuery("laptop within 50000").maxPrice === 50000);
check("30k form", parseSearchQuery("phone under 30k").maxPrice === 30000);
check("above", parseSearchQuery("laptop above 40000").minPrice === 40000);
check("over", parseSearchQuery("laptop over 40000").minPrice === 40000);
check("at least", parseSearchQuery("laptop at least 40000").minPrice === 40000);
{
  const q = parseSearchQuery("laptop between 30000 and 60000");
  check("between -> both bounds", q.minPrice === 30000 && q.maxPrice === 60000, q);
}
{
  const q = parseSearchQuery("laptop 30000-60000");
  check("dash range -> both bounds", q.minPrice === 30000 && q.maxPrice === 60000, q);
}
{
  // Reversed bounds must be normalized, not applied backwards (which would
  // return zero results).
  const q = parseSearchQuery("laptop between 60000 and 30000");
  check("reversed range normalized", q.minPrice === 30000 && q.maxPrice === 60000, q);
}

console.log("Sort intent");
check("cheapest -> price_low_high", parseSearchQuery("cheapest phone").impliedSort === "price_low_high");
check("latest -> newest", parseSearchQuery("latest phone").impliedSort === "newest");
check("deals -> discount", parseSearchQuery("phone deals").impliedSort === "discount");
check("no intent -> undefined", parseSearchQuery("iphone").impliedSort === undefined);

console.log("Spec extraction");
{
  const q = parseSearchQuery("512GB laptop");
  check("storage axis", q.variantAxes.storage === "512GB", q.variantAxes);
}
{
  const q = parseSearchQuery("55 inch tv");
  check("screen axis", q.variantAxes.screen === "55IN", q.variantAxes);
}
{
  // Colour must NOT become a hard filter — that would hide every other
  // colourway of the same model.
  const q = parseSearchQuery("black phone");
  check("colour is not a filter", q.variantAxes.color === undefined, q.variantAxes);
  check("colour stays in text for ranking", q.text.includes("black"), q.text);
}
{
  const q = parseSearchQuery("laptop 16GB RAM 512GB SSD under 80000");
  check("ram + storage + price together",
    q.variantAxes.ram === "16GB" && q.variantAxes.storage === "512GB" && q.maxPrice === 80000, q);
}

console.log("Edge cases");
check("empty query", parseSearchQuery("").text === "");
check("whitespace only", parseSearchQuery("   ").text === "");
{
  const q = parseSearchQuery("show me the best laptop for gaming");
  check("stopwords removed", !q.text.includes("show") && !q.text.includes("the") && !q.text.includes("for"), q.text);
  check("meaningful words kept", q.text.includes("laptop") && q.text.includes("gaming"), q.text);
}
{
  const q = parseSearchQuery("under 50000");
  check("filter-only query detected", isFilterOnlyQuery(q), q);
}
{
  const q = parseSearchQuery("iphone");
  check("plain query is not filter-only", !isFilterOnlyQuery(q));
}
{
  // A very long query must not blow up.
  const q = parseSearchQuery("a".repeat(500) + " under 5000");
  check("long query handled", q.maxPrice === 5000);
}
{
  // SQL-injection-shaped input must be treated as plain text.
  const q = parseSearchQuery("'; DROP TABLE products; --");
  check("injection chars normalized away", !q.text.includes("'") && !q.text.includes(";"), q.text);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
