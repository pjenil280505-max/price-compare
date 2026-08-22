import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notFound, withErrorHandling } from "@/lib/server/errors";
import { fetchProductBySlug } from "@/lib/server/products";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export const GET = withErrorHandling(async (_request: Request, { params }: RouteParams) => {
  const { slug } = await params;
  const supabase = await createClient();

  const product = await fetchProductBySlug(supabase, slug);
  if (!product) throw notFound("Product not found");

  return NextResponse.json(product);
});
