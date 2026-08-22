import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import type { Merchant } from "@/lib/types";

export const GET = withErrorHandling(async () => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("merchants")
    .select("id, name, slug, logo_url, trust_rating, merchant_offers(count)")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw error;

  const merchants: Merchant[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url ?? "",
    trustRating: row.trust_rating ?? undefined,
    productCount: Array.isArray(row.merchant_offers) ? (row.merchant_offers[0]?.count ?? 0) : undefined,
  }));

  return NextResponse.json(merchants);
});
