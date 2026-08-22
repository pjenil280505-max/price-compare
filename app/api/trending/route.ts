import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { fetchProductsByIds } from "@/lib/server/products";

export const GET = withErrorHandling(async () => {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_trending_products", { p_limit: 12 });
  if (error) throw error;

  const ids = (data ?? []).map((row: { product_id: string }) => row.product_id);
  const products = await fetchProductsByIds(supabase, ids);

  return NextResponse.json(products);
});
