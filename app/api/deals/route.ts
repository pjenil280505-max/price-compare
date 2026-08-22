import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import type { Deal, MerchantOffer } from "@/lib/types";
import { fetchProductsByIds } from "@/lib/server/products";

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

export const GET = withErrorHandling(async (request: Request) => {
  const category = new URL(request.url).searchParams.get("category") ?? undefined;
  const supabase = await createClient();

  const { data: dealRows, error: dealError } = await supabase.rpc("get_deals", {
    p_category_slug: category ?? null,
    p_limit: 24,
  });
  if (dealError) throw dealError;

  const offerIds: string[] = (dealRows ?? []).map((r: { merchant_offer_id: string }) => r.merchant_offer_id);
  if (offerIds.length === 0) return NextResponse.json<Deal[]>([]);

  // Fetch each deal's own offer/price/merchant directly — deliberately not
  // reusing Product.offers, which is scoped to a product's primary variant
  // only and would silently drop any deal that happens to be on a
  // different variant.
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

  const offerRowById = new Map(offerRows.map((row) => [row.id, row]));
  const productIds = Array.from(
    new Set(offerRows.map((row) => row.product_variants?.product_id).filter((id): id is string => id != null)),
  );

  const products = await fetchProductsByIds(supabase, productIds);
  const productById = new Map(products.map((p) => [p.id, p]));

  const deals: Deal[] = offerIds
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

  return NextResponse.json(deals);
});
