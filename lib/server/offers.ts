import type { SupabaseClient } from "@supabase/supabase-js";

export interface OfferRedirectInfo {
  id: string;
  destinationUrl: string;
  isActive: boolean;
}

/** Just enough to redirect and log a click — not the full Product hydration. */
export async function fetchOfferRedirectInfo(
  supabase: SupabaseClient,
  offerId: string,
): Promise<OfferRedirectInfo | null> {
  const { data, error } = await supabase
    .from("merchant_offers")
    .select("id, destination_url, is_active")
    .eq("id", offerId)
    .limit(1)
    .returns<{ id: string; destination_url: string; is_active: boolean }[]>();

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const row = data[0];
  return { id: row.id, destinationUrl: row.destination_url, isActive: row.is_active };
}
