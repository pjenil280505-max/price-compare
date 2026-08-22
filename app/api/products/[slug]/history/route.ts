import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notFound, withErrorHandling } from "@/lib/server/errors";
import type { PriceHistoryPoint } from "@/lib/types";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export const GET = withErrorHandling(async (request: Request, { params }: RouteParams) => {
  const { slug } = await params;
  const rangeDays = Number(new URL(request.url).searchParams.get("range")) || 90;

  const supabase = await createClient();

  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("slug", slug)
    .limit(1);

  if (productError) throw productError;
  if (!productRows || productRows.length === 0) throw notFound("Product not found");

  const { data, error } = await supabase.rpc("get_price_history", {
    p_product_id: productRows[0].id,
    p_range_days: rangeDays,
  });

  if (error) throw error;

  const points: PriceHistoryPoint[] = (data ?? []).map(
    (row: { day: string; price: number; mrp: number | null; in_stock: boolean }) => ({
      date: row.day,
      price: row.price,
      mrp: row.mrp ?? undefined,
      inStock: row.in_stock,
    }),
  );

  return NextResponse.json(points);
});
