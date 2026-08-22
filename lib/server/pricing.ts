import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProductPricing,
  type Freshness,
  type MerchantPrice,
  type PriceStatistics,
  type ProductPricing,
} from "@/lib/pricing/engine";

/**
 * Loads the full pricing picture for a product. Freshness is computed in
 * SQL (public.price_freshness) so the verdict is consistent for every
 * consumer — this layer only maps it into the typed domain.
 */

interface PricingRow {
  offer_id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_slug: string;
  merchant_logo_url: string | null;
  price: number | null;
  mrp: number | null;
  discount_percent: number | null;
  in_stock: boolean;
  cod_available: boolean | null;
  rating: number | null;
  review_count: number | null;
  destination_url: string;
  last_checked_at: string;
  freshness: Freshness;
  previous_price: number | null;
  price_change: number | null;
  price_change_percent: number | null;
  is_cheapest: boolean;
  difference_from_best: number | null;
}

interface StatisticsRow {
  lowest_price: number | null;
  lowest_price_at: string | null;
  highest_price: number | null;
  highest_price_at: string | null;
  average_price: number | null;
  observation_days: number;
  observation_count: number;
  has_sufficient_data: boolean;
  is_at_lowest: boolean;
  current_best_price: number | null;
}

const EMPTY_STATISTICS: PriceStatistics = {
  lowestPrice: null,
  lowestPriceAt: null,
  highestPrice: null,
  highestPriceAt: null,
  averagePrice: null,
  observationDays: 0,
  observationCount: 0,
  hasSufficientData: false,
  isAtLowest: false,
  currentBestPrice: null,
};

export async function fetchProductPricing(
  supabase: SupabaseClient,
  productId: string,
): Promise<ProductPricing> {
  const [pricingRes, statsRes] = await Promise.all([
    supabase.rpc("get_product_pricing", { p_product_id: productId }),
    supabase.rpc("get_price_statistics", { p_product_id: productId }),
  ]);

  if (pricingRes.error) throw pricingRes.error;
  if (statsRes.error) throw statsRes.error;

  const offers: MerchantPrice[] = ((pricingRes.data ?? []) as PricingRow[]).map((row) => ({
    offerId: row.offer_id,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    merchantSlug: row.merchant_slug,
    merchantLogoUrl: row.merchant_logo_url ?? "",
    price: row.price,
    mrp: row.mrp ?? undefined,
    discountPercent: row.discount_percent ?? undefined,
    inStock: row.in_stock,
    codAvailable: row.cod_available ?? undefined,
    rating: row.rating ?? undefined,
    reviewCount: row.review_count ?? undefined,
    // Always the internal redirect — never the raw destination_url.
    buyUrl: `/go/${row.offer_id}`,
    lastCheckedAt: row.last_checked_at,
    freshness: row.freshness,
    previousPrice: row.previous_price ?? undefined,
    priceChange: row.price_change ?? undefined,
    priceChangePercent: row.price_change_percent ?? undefined,
    isCheapest: row.is_cheapest,
    differenceFromBest: row.difference_from_best ?? undefined,
  }));

  const statsRow = ((statsRes.data ?? []) as StatisticsRow[])[0];

  const statistics: PriceStatistics = statsRow
    ? {
        lowestPrice: statsRow.lowest_price,
        lowestPriceAt: statsRow.lowest_price_at,
        highestPrice: statsRow.highest_price,
        highestPriceAt: statsRow.highest_price_at,
        averagePrice: statsRow.average_price,
        observationDays: statsRow.observation_days ?? 0,
        observationCount: statsRow.observation_count ?? 0,
        hasSufficientData: statsRow.has_sufficient_data ?? false,
        isAtLowest: statsRow.is_at_lowest ?? false,
        currentBestPrice: statsRow.current_best_price,
      }
    : EMPTY_STATISTICS;

  return buildProductPricing(offers, statistics);
}

export interface StaleOffer {
  offerId: string;
  merchantName: string;
  productTitle: string;
  price: number;
  lastCheckedAt: string;
  hoursSinceCheck: number;
  freshness: Freshness;
}

/** Operational view for the admin dashboard: what has gone stale. */
export async function fetchStaleOffers(supabase: SupabaseClient, limit = 100): Promise<StaleOffer[]> {
  const { data, error } = await supabase.rpc("get_stale_offers", { p_limit: limit });
  if (error) throw error;

  return ((data ?? []) as {
    offer_id: string;
    merchant_name: string;
    product_title: string;
    price: number;
    last_checked_at: string;
    hours_since_check: number;
    freshness: Freshness;
  }[]).map((row) => ({
    offerId: row.offer_id,
    merchantName: row.merchant_name,
    productTitle: row.product_title,
    price: row.price,
    lastCheckedAt: row.last_checked_at,
    hoursSinceCheck: row.hours_since_check,
    freshness: row.freshness,
  }));
}
