import type { SupabaseClient } from "@supabase/supabase-js";
import type { MerchantOffer, Product, ProductVariant } from "@/lib/types";
import type { DbProductRow } from "./dbTypes";

/**
 * Nested select used everywhere a full Product needs to be hydrated. Kept
 * as one constant so every route asks for exactly the same shape — no
 * endpoint accidentally omits a field another one depends on.
 */
export const PRODUCT_SELECT = `
  id, slug, title, description, specs, primary_image_url, images,
  brands ( id, name, slug ),
  categories ( id, name, slug ),
  product_variants (
    id, label, attributes, is_active, created_at,
    merchant_offers (
      id, destination_url, is_active,
      merchants ( id, name, slug, logo_url, trust_rating ),
      prices ( price, mrp, currency, in_stock, cod_available, rating, review_count, last_checked_at )
    )
  )
`;

/**
 * Maps one raw nested Supabase row to the frontend's Product shape.
 * `offers` comes from a single "primary" variant (the earliest-created
 * one) rather than every variant's offers pooled together — comparing a
 * 128GB listing's price against a 256GB one under one "cheapest offer"
 * would be misleading. `variants` still lists every variant for a future
 * variant-switcher UI.
 */
export function mapProductRow(row: DbProductRow): Product {
  const activeVariants = [...(row.product_variants ?? [])]
    .filter((v) => v.is_active)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const primaryVariant = activeVariants[0];

  const offers: MerchantOffer[] = (primaryVariant?.merchant_offers ?? [])
    .filter((offer) => offer.is_active && offer.prices != null && offer.merchants != null)
    .map((offer) => ({
      id: offer.id,
      merchant: {
        id: offer.merchants!.id,
        name: offer.merchants!.name,
        slug: offer.merchants!.slug,
        logoUrl: offer.merchants!.logo_url ?? "",
        trustRating: offer.merchants!.trust_rating ?? undefined,
      },
      price: offer.prices!.price,
      mrp: offer.prices!.mrp ?? undefined,
      currency: "INR",
      inStock: offer.prices!.in_stock,
      codAvailable: offer.prices!.cod_available,
      rating: offer.prices!.rating ?? undefined,
      reviewCount: offer.prices!.review_count ?? undefined,
      // Always the internal redirect, never the raw destination_url — see
      // lib/types.ts's MerchantOffer.buyUrl comment and app/go/[offerId].
      buyUrl: `/go/${offer.id}`,
      lastCheckedAt: offer.prices!.last_checked_at,
    }));

  const variants: ProductVariant[] = activeVariants.map((v) => ({
    id: v.id,
    label: v.label,
    attributes: v.attributes ?? {},
  }));

  const ratedOffers = offers.filter((o) => o.rating != null);
  const aggregateRating =
    ratedOffers.length > 0
      ? ratedOffers.reduce((sum, o) => sum + (o.rating ?? 0), 0) / ratedOffers.length
      : undefined;
  const totalReviews = offers.reduce((sum, o) => sum + (o.reviewCount ?? 0), 0);

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    brand: row.brands?.name,
    category: row.categories?.name ?? "Uncategorized",
    imageUrl: row.primary_image_url,
    images: row.images ?? undefined,
    description: row.description ?? undefined,
    specs: row.specs ?? undefined,
    rating: aggregateRating,
    reviewCount: totalReviews > 0 ? totalReviews : undefined,
    variants,
    selectedVariantId: primaryVariant?.id,
    offers,
  };
}

export async function fetchProductBySlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<Product | null> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .limit(1)
    .returns<DbProductRow[]>();

  if (error) throw error;
  if (!data || data.length === 0) return null;
  return mapProductRow(data[0]);
}

/** Fetches products by id, preserving the input order (callers like search/deals rely on this for ranking). */
export async function fetchProductsByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Product[]> {
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .in("id", ids)
    .returns<DbProductRow[]>();

  if (error) throw error;

  const byId = new Map<string, Product>(data.map((row: DbProductRow) => [row.id, mapProductRow(row)]));
  return ids.map((id) => byId.get(id)).filter((p): p is Product => p != null);
}
