import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FilterOptions, SortOption } from "@/lib/types";
import type { Freshness } from "@/lib/pricing/engine";
import { parseSearchQuery, type ParsedQuery } from "@/lib/search/queryParser";
import type { SearchResponse, SearchResultItem } from "@/lib/search/types";

/**
 * Search orchestration.
 *
 * Calls public.search_products, which returns display-ready rows in one
 * round trip — no per-result hydration. Freshness and variant selection are
 * decided in SQL by the same functions the product page uses, so search
 * results and product pages can never disagree about a price.
 */

export const PAGE_SIZE = 24;
const MAX_PAGE = 200; // deep pagination is a scraping vector, not a user need

export const searchRequestSchema = z.object({
  query: z.string().max(200).default(""),
  categorySlug: z.string().max(200).optional(),
  filters: z
    .object({
      priceMin: z.number().nonnegative().max(100_000_000).optional(),
      priceMax: z.number().nonnegative().max(100_000_000).optional(),
      merchantIds: z.array(z.string().uuid()).max(50).optional(),
      brands: z.array(z.string().max(120)).max(50).optional(),
      minRating: z.number().min(0).max(5).optional(),
      minDiscount: z.number().min(0).max(100).optional(),
      inStockOnly: z.boolean().optional(),
    })
    .optional(),
  sort: z
    .enum(["relevance", "price_low_high", "price_high_low", "discount", "rating", "newest"])
    .optional(),
  page: z.number().int().positive().max(MAX_PAGE).optional(),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

interface SearchRow {
  product_id: string;
  slug: string;
  title: string;
  brand_name: string | null;
  category_name: string | null;
  primary_image_url: string | null;
  created_at: string;
  variant_id: string;
  variant_label: string | null;
  best_offer_id: string | null;
  best_price: number | null;
  best_mrp: number | null;
  best_discount_percent: number | null;
  best_in_stock: boolean | null;
  best_freshness: Freshness | null;
  best_last_checked_at: string | null;
  merchant_id: string | null;
  merchant_name: string | null;
  merchant_slug: string | null;
  merchant_logo_url: string | null;
  offer_count: number;
  avg_rating: number | null;
  total_reviews: number;
  relevance: number;
  total_count: number;
}

export async function performSearch(
  supabase: SupabaseClient,
  params: SearchRequest,
): Promise<SearchResponse> {
  const parsed = parseSearchQuery(params.query ?? "");

  // Explicit filters always beat parsed ones: if the user set a price
  // slider, that is a deliberate act and must not be overridden by a
  // phrase left over in the search box.
  const minPrice = params.filters?.priceMin ?? parsed.minPrice;
  const maxPrice = params.filters?.priceMax ?? parsed.maxPrice;

  // Same precedence for sort — an explicit sort selection wins over the
  // sort merely implied by wording like "best".
  const appliedSort: SortOption = params.sort ?? parsed.impliedSort ?? "relevance";

  const page = params.page ?? 1;

  // Filter options are catalog-wide and independent of the query, so they
  // must not be awaited AFTER the search — that added four sequential
  // round trips to every request's latency.
  const filterOptionsPromise = getFilterOptions(supabase);

  const { data, error } = await supabase.rpc("search_products", {
    search_query: parsed.text,
    p_category_slug: params.categorySlug ?? null,
    p_merchant_ids: params.filters?.merchantIds?.length ? params.filters.merchantIds : null,
    p_brand_names: params.filters?.brands?.length ? params.filters.brands : null,
    p_min_price: minPrice ?? null,
    p_max_price: maxPrice ?? null,
    p_min_rating: params.filters?.minRating ?? null,
    p_in_stock_only: params.filters?.inStockOnly ?? false,
    p_min_discount: params.filters?.minDiscount ?? null,
    p_variant_axes: parsed.variantAxes,
    p_sort: appliedSort,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });

  if (error) throw error;

  const rows = (data ?? []) as SearchRow[];
  const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;

  const items: SearchResultItem[] = rows.map((row) => ({
    productId: row.product_id,
    slug: row.slug,
    title: row.title,
    brand: row.brand_name ?? undefined,
    category: row.category_name ?? undefined,
    imageUrl: row.primary_image_url ?? "",
    variantId: row.variant_id,
    variantLabel: row.variant_label ?? "Standard",
    bestPrice: row.best_price,
    mrp: row.best_mrp ?? undefined,
    discountPercent: row.best_discount_percent ?? undefined,
    inStock: row.best_in_stock ?? false,
    freshness: row.best_freshness,
    lastCheckedAt: row.best_last_checked_at,
    merchantName: row.merchant_name ?? undefined,
    merchantSlug: row.merchant_slug ?? undefined,
    merchantLogoUrl: row.merchant_logo_url ?? undefined,
    buyUrl: row.best_offer_id ? `/go/${row.best_offer_id}` : null,
    offerCount: row.offer_count ?? 0,
    rating: row.avg_rating ?? undefined,
    reviewCount: row.total_reviews || undefined,
  }));

  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.min(MAX_PAGE, Math.ceil(total / PAGE_SIZE)),
    parsed: {
      text: parsed.text,
      minPrice: parsed.minPrice,
      maxPrice: parsed.maxPrice,
      variantAxes: parsed.variantAxes as Record<string, string>,
      impliedSort: parsed.impliedSort,
      hints: parsed.appliedHints,
    },
    appliedSort,
    filterOptions: await filterOptionsPromise,
  };
}

/**
 * Facet options for the filter sidebar. Cached-friendly and cheap: these
 * are catalog-wide, not per-result, so they don't change per query.
 */
/**
 * Short-lived in-process cache. Filter facets are catalog-wide and change
 * only when ingestion runs, so recomputing them on every keystroke-driven
 * search is pure waste. Same caveat as lib/server/rateLimit.ts: on
 * serverless each instance keeps its own copy, which is fine here — a
 * slightly stale price bound or brand list has no correctness impact,
 * unlike a stale price.
 */
const FILTER_OPTIONS_TTL_MS = 5 * 60 * 1000;
let filterOptionsCache: { value: FilterOptions; expiresAt: number } | null = null;

export async function getFilterOptions(supabase: SupabaseClient): Promise<FilterOptions> {
  if (filterOptionsCache && Date.now() < filterOptionsCache.expiresAt) {
    return filterOptionsCache.value;
  }

  const [merchantsRes, brandsRes, minPriceRes, maxPriceRes] = await Promise.all([
    supabase.from("merchants").select("id, name, slug, logo_url, trust_rating").eq("is_active", true),
    supabase.from("brands").select("name").order("name").limit(200),
    supabase.from("prices").select("price").eq("in_stock", true).order("price", { ascending: true }).limit(1),
    supabase.from("prices").select("price").eq("in_stock", true).order("price", { ascending: false }).limit(1),
  ]);

  if (merchantsRes.error) throw merchantsRes.error;
  if (brandsRes.error) throw brandsRes.error;
  if (minPriceRes.error) throw minPriceRes.error;
  if (maxPriceRes.error) throw maxPriceRes.error;

  const merchantRows = (merchantsRes.data ?? []) as Record<string, unknown>[];
  const merchants = merchantRows.map((m) => ({
    id: m.id as string,
    name: m.name as string,
    slug: m.slug as string,
    logoUrl: (m.logo_url as string) ?? "",
    trustRating: (m.trust_rating as number) ?? undefined,
  }));

  const brandRows = (brandsRes.data ?? []) as { name: string }[];
  const brands: string[] = Array.from(new Set(brandRows.map((b) => b.name).filter(Boolean)));

  const min = minPriceRes.data?.[0]?.price ?? 0;
  const max = maxPriceRes.data?.[0]?.price ?? Math.max(min, 100000);

  const value: FilterOptions = { merchants, brands, priceBounds: { min, max } };
  filterOptionsCache = { value, expiresAt: Date.now() + FILTER_OPTIONS_TTL_MS };
  return value;
}

export type { ParsedQuery };
export type { SearchResponse, SearchResultItem } from "@/lib/search/types";
