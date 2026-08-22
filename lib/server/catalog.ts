import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Deal, Merchant, MerchantOffer, PriceHistoryPoint, Product } from "@/lib/types";
import { fetchProductsByIds } from "@/lib/server/products";
import { notFound } from "@/lib/server/errors";

/**
 * CATALOG DATA LAYER
 *
 * Why this exists: Server Components were calling their own API routes over
 * HTTP (`api.getCategories()` → `fetch("/api/categories")`). That works at
 * request time but breaks during `next build`, because static generation
 * runs with no server listening — the build fails with ECONNREFUSED while
 * prerendering.
 *
 * It is also simply wasteful: the page and the route run in the same
 * process, so the HTTP hop adds serialization, a socket, and a second
 * Supabase client for data the page could read directly.
 *
 * These functions are the single source of truth. Server Components call
 * them directly; the API routes call them too, staying as thin wrappers for
 * client-side callers. No logic is duplicated between the two paths.
 */

export async function fetchCategories(supabase: SupabaseClient): Promise<Category[]> {
  // Product count per category — a straightforward correlated subquery is
  // fine here since categories are a small, mostly-static table.
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug, image_url, products(count)")
    .order("display_order", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    imageUrl: (row.image_url as string) ?? "",
    productCount: Array.isArray(row.products) ? (row.products[0]?.count ?? 0) : undefined,
  }));
}

export async function fetchMerchants(supabase: SupabaseClient): Promise<Merchant[]> {
  const { data, error } = await supabase
    .from("merchants")
    .select("id, name, slug, logo_url, trust_rating, merchant_offers(count)")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    logoUrl: (row.logo_url as string) ?? "",
    trustRating: (row.trust_rating as number) ?? undefined,
    productCount: Array.isArray(row.merchant_offers) ? (row.merchant_offers[0]?.count ?? 0) : undefined,
  }));
}

export async function fetchTrending(supabase: SupabaseClient): Promise<Product[]> {
  const { data, error } = await supabase.rpc("get_trending_products", { p_limit: 12 });
  if (error) throw error;

  const ids = (data ?? []).map((row: { product_id: string }) => row.product_id);
  return fetchProductsByIds(supabase, ids);
}

interface DealOfferRow {
  id: string;
  destination_url: string;
  product_variants: { product_id: string } | null;
  merchants: { id: string; name: string; slug: string; logo_url: string | null; trust_rating: number | null } | null;
  prices: {
    price: number;
    mrp: number | null;
    in_stock: boolean;
    cod_available: boolean;
    rating: number | null;
    review_count: number | null;
    last_checked_at: string;
  } | null;
}

export async function fetchDeals(supabase: SupabaseClient, category?: string): Promise<Deal[]> {
  const { data: dealRows, error: dealError } = await supabase.rpc("get_deals", {
    p_category_slug: category ?? null,
    p_limit: 24,
  });
  if (dealError) throw dealError;

  const offerIds: string[] = (dealRows ?? []).map((r: { merchant_offer_id: string }) => r.merchant_offer_id);
  if (offerIds.length === 0) return [];

  // Each deal's own offer/price/merchant is fetched directly — deliberately
  // NOT reused from Product.offers, which is scoped to a product's primary
  // variant and would silently drop any deal on a different variant.
  const { data: offerRows, error: offerError } = await supabase
    .from("merchant_offers")
    .select(
      `id, destination_url,
       product_variants ( product_id ),
       merchants ( id, name, slug, logo_url, trust_rating ),
       prices ( price, mrp, in_stock, cod_available, rating, review_count, last_checked_at )`,
    )
    .in("id", offerIds)
    .returns<DealOfferRow[]>();

  if (offerError) throw offerError;

  const offerRowById = new Map<string, DealOfferRow>((offerRows ?? []).map((row) => [row.id, row]));
  const productIds: string[] = Array.from(
    new Set(
      (offerRows ?? [])
        .map((row) => row.product_variants?.product_id)
        .filter((id): id is string => id != null),
    ),
  );

  const products = await fetchProductsByIds(supabase, productIds);
  const productById = new Map<string, Product>(products.map((p) => [p.id, p]));

  return offerIds
    .map((offerId): Deal | null => {
      const row = offerRowById.get(offerId);
      const productId = row?.product_variants?.product_id;
      const product = productId ? productById.get(productId) : undefined;
      if (!row || !row.merchants || !row.prices || !product) return null;

      const offer: MerchantOffer = {
        id: row.id,
        merchant: {
          id: row.merchants.id,
          name: row.merchants.name,
          slug: row.merchants.slug,
          logoUrl: row.merchants.logo_url ?? "",
          trustRating: row.merchants.trust_rating ?? undefined,
        },
        price: row.prices.price,
        mrp: row.prices.mrp ?? undefined,
        currency: "INR",
        inStock: row.prices.in_stock,
        codAvailable: row.prices.cod_available,
        rating: row.prices.rating ?? undefined,
        reviewCount: row.prices.review_count ?? undefined,
        buyUrl: `/go/${row.id}`,
        lastCheckedAt: row.prices.last_checked_at,
      };

      return { id: offerId, product, offer, label: "Price drop" };
    })
    .filter((d): d is Deal => d != null);
}

/** Resolves a slug to a product id, or throws a 404. */
async function productIdBySlug(supabase: SupabaseClient, slug: string): Promise<string> {
  const { data, error } = await supabase.from("products").select("id").eq("slug", slug).limit(1);
  if (error) throw error;
  if (!data || data.length === 0) throw notFound("Product not found");
  return data[0].id as string;
}

export async function fetchPriceHistory(
  supabase: SupabaseClient,
  slug: string,
  rangeDays = 90,
): Promise<PriceHistoryPoint[]> {
  const productId = await productIdBySlug(supabase, slug);

  const { data, error } = await supabase.rpc("get_price_history", {
    p_product_id: productId,
    p_range_days: rangeDays,
  });
  if (error) throw error;

  return (data ?? []).map((row: { day: string; price: number; mrp: number | null; in_stock: boolean }) => ({
    date: row.day,
    price: row.price,
    mrp: row.mrp ?? undefined,
    inStock: row.in_stock,
  }));
}

export async function fetchAlternatives(supabase: SupabaseClient, slug: string): Promise<Product[]> {
  const productId = await productIdBySlug(supabase, slug);

  const { data, error } = await supabase.rpc("get_product_alternatives", {
    p_product_id: productId,
    p_limit: 8,
  });
  if (error) throw error;

  const ids = (data ?? []).map((row: { product_id: string }) => row.product_id);
  return fetchProductsByIds(supabase, ids);
}
