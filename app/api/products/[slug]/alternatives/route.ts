import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notFound, withErrorHandling } from "@/lib/server/errors";
import { fetchProductsByIds } from "@/lib/server/products";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export const GET = withErrorHandling(async (_request: Request, { params }: RouteParams) => {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("slug", slug)
    .limit(1);

  if (productError) throw productError;
  if (!productRows || productRows.length === 0) throw notFound("Product not found");

  const { data, error } = await supabase.rpc("get_product_alternatives", {
    p_product_id: productRows[0].id,
    p_limit: 8,
  });

  if (error) throw error;

  const ids = (data ?? []).map((row: { product_id: string }) => row.product_id);
  const products = await fetchProductsByIds(supabase, ids);

  return NextResponse.json(products);
});
