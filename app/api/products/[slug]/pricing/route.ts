import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notFound, withErrorHandling } from "@/lib/server/errors";
import { fetchProductPricing } from "@/lib/server/pricing";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export const GET = withErrorHandling(async (_request: Request, { params }: RouteParams) => {
  const { slug } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.from("products").select("id").eq("slug", slug).limit(1);
  if (error) throw error;
  if (!data || data.length === 0) throw notFound("Product not found");

  const pricing = await fetchProductPricing(supabase, data[0].id);
  return NextResponse.json(pricing);
});
