import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { fetchProductsByIds } from "@/lib/server/products";

const requestSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(4),
});

export const POST = withErrorHandling(async (request: Request) => {
  const { productIds } = requestSchema.parse(await request.json());
  const supabase = await createClient();
  const products = await fetchProductsByIds(supabase, productIds);
  return NextResponse.json(products);
});
