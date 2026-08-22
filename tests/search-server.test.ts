/**
 * Search server-layer tests. Uses a stub Supabase client so the real
 * mapping, precedence and pagination logic runs — only the network is
 * faked, not the code under test.
 */
import { performSearch, PAGE_SIZE, searchRequestSchema } from "../lib/server/search.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

let lastRpcArgs: Record<string, unknown> | null = null;

function row(over: Record<string, unknown> = {}) {
  return {
    product_id: "p1", slug: "prod-1", title: "Test Phone", brand_name: "TestBrand",
    category_name: "Phones", primary_image_url: "https://cdn/x.jpg",
    created_at: "2026-01-01T00:00:00Z",
    variant_id: "v1", variant_label: "128GB · Black",
    best_offer_id: "o1", best_price: 19999, best_mrp: 24999, best_discount_percent: 20,
    best_in_stock: true, best_freshness: "fresh", best_last_checked_at: "2026-08-20T10:00:00Z",
    merchant_id: "m1", merchant_name: "Store A", merchant_slug: "a", merchant_logo_url: "",
    offer_count: 3, avg_rating: 4.3, total_reviews: 120,
    relevance: 0.8, total_count: 1,
    ...over,
  };
}

function stubClient(rows: Record<string, unknown>[]) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "search_products") {
        lastRpcArgs = args;
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    },
    from: () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, eq: self, order: self,
        limit: async () => ({ data: [], error: null }),
      });
      // Terminal awaits used by getFilterOptions
      (chain as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null });
      return chain;
    },
  } as never;
}

console.log("Request validation");
check("rejects oversized query", !searchRequestSchema.safeParse({ query: "x".repeat(300) }).success);
check("rejects page 0", !searchRequestSchema.safeParse({ query: "a", page: 0 }).success);
check("rejects deep pagination", !searchRequestSchema.safeParse({ query: "a", page: 5000 }).success);
check("rejects bad uuid merchant", !searchRequestSchema.safeParse({ query: "a", filters: { merchantIds: ["nope"] } }).success);
check("rejects rating above 5", !searchRequestSchema.safeParse({ query: "a", filters: { minRating: 9 } }).success);
check("accepts valid request", searchRequestSchema.safeParse({ query: "iphone", page: 2 }).success);
check("defaults empty query", searchRequestSchema.parse({}).query === "");

console.log("Natural-language parsing reaches the SQL call");
{
  await performSearch(stubClient([row()]), { query: "gaming laptop under ₹60,000" });
  check("maxPrice forwarded", lastRpcArgs?.p_max_price === 60000, lastRpcArgs?.p_max_price);
  check("price phrase stripped from text", !String(lastRpcArgs?.search_query).includes("60"), lastRpcArgs?.search_query);
  check("subject forwarded", String(lastRpcArgs?.search_query).includes("laptop"));
}
{
  await performSearch(stubClient([row()]), { query: "16GB RAM laptop" });
  check("variant axes forwarded", (lastRpcArgs?.p_variant_axes as Record<string, string>)?.ram === "16GB",
    lastRpcArgs?.p_variant_axes);
}
{
  const r = await performSearch(stubClient([row()]), { query: "best phone" });
  check("implied sort applied", r.appliedSort === "rating", r.appliedSort);
  check("implied sort forwarded to SQL", lastRpcArgs?.p_sort === "rating");
}

console.log("Precedence: explicit user choices beat parsed intent");
{
  // A user who set a slider must not have it overridden by leftover text.
  await performSearch(stubClient([row()]), {
    query: "laptop under 60000",
    filters: { priceMax: 40000 },
  });
  check("explicit priceMax wins over parsed", lastRpcArgs?.p_max_price === 40000, lastRpcArgs?.p_max_price);
}
{
  const r = await performSearch(stubClient([row()]), { query: "best phone", sort: "price_low_high" });
  check("explicit sort wins over implied", r.appliedSort === "price_low_high", r.appliedSort);
}

console.log("Pagination math");
{
  await performSearch(stubClient([row()]), { query: "phone", page: 3 });
  check("offset computed from page", lastRpcArgs?.p_offset === PAGE_SIZE * 2, lastRpcArgs?.p_offset);
  check("limit is page size", lastRpcArgs?.p_limit === PAGE_SIZE);
}
{
  const r = await performSearch(stubClient([row({ total_count: 100 })]), { query: "phone" });
  check("totalPages from total", r.totalPages === Math.ceil(100 / PAGE_SIZE), r.totalPages);
  check("total surfaced", r.total === 100);
}
{
  const r = await performSearch(stubClient([]), { query: "nothing" });
  check("empty results -> total 0", r.total === 0);
  check("empty results -> 0 pages", r.totalPages === 0);
  check("empty results -> empty items", r.items.length === 0);
}
{
  // total_count arrives from Postgres as a bigint, which PostgREST may
  // serialize as a string. Number() coercion must handle both.
  const r = await performSearch(stubClient([row({ total_count: "250" })]), { query: "phone" });
  check("string bigint total coerced", r.total === 250, r.total);
}

console.log("Result mapping");
{
  const r = await performSearch(stubClient([row()]), { query: "phone" });
  const item = r.items[0];
  check("buyUrl is internal redirect", item.buyUrl === "/go/o1", item.buyUrl);
  check("variant label surfaced", item.variantLabel === "128GB · Black");
  check("offer count surfaced", item.offerCount === 3);
  check("freshness surfaced", item.freshness === "fresh");
  check("discount surfaced", item.discountPercent === 20);
}
{
  // A product with no eligible offer must map to a null price, never 0 —
  // rendering ₹0 would be worse than showing nothing.
  const r = await performSearch(stubClient([row({
    best_offer_id: null, best_price: null, best_in_stock: null,
    best_freshness: null, best_last_checked_at: null, merchant_name: null, offer_count: 0,
  })]), { query: "phone" });
  const item = r.items[0];
  check("null price stays null", item.bestPrice === null, item.bestPrice);
  check("no buyUrl without an offer", item.buyUrl === null);
  check("inStock false when unknown", item.inStock === false);
  check("offerCount zero", item.offerCount === 0);
}
{
  const r = await performSearch(stubClient([row({ best_freshness: "stale" })]), { query: "phone" });
  check("stale freshness passed through for labelling", r.items[0].freshness === "stale");
}
{
  // Search must never receive 'expired' from SQL, but if it somehow did the
  // shape must still be handled rather than crashing.
  const r = await performSearch(stubClient([row({ best_freshness: "expired" })]), { query: "phone" });
  check("expired value handled without crashing", r.items[0].freshness === "expired");
}

console.log("Filters forwarded correctly");
{
  await performSearch(stubClient([row()]), {
    query: "phone",
    filters: {
      merchantIds: ["11111111-1111-1111-1111-111111111111"],
      brands: ["Apple"], minRating: 4, minDiscount: 15, inStockOnly: true,
    },
  });
  check("merchant filter forwarded", Array.isArray(lastRpcArgs?.p_merchant_ids));
  check("brand filter forwarded", (lastRpcArgs?.p_brand_names as string[])?.[0] === "Apple");
  check("rating filter forwarded", lastRpcArgs?.p_min_rating === 4);
  check("discount filter forwarded", lastRpcArgs?.p_min_discount === 15);
  check("stock filter forwarded", lastRpcArgs?.p_in_stock_only === true);
}
{
  // Empty arrays must become null, not [] — an empty IN () would match zero
  // rows and silently return nothing.
  await performSearch(stubClient([row()]), { query: "phone", filters: { merchantIds: [], brands: [] } });
  check("empty merchant array -> null", lastRpcArgs?.p_merchant_ids === null, lastRpcArgs?.p_merchant_ids);
  check("empty brand array -> null", lastRpcArgs?.p_brand_names === null, lastRpcArgs?.p_brand_names);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
