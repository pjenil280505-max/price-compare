import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { requireUser } from "@/lib/server/auth";
import { fetchProductsByIds } from "@/lib/server/products";
import type { WishlistItem } from "@/lib/types";

/** Most-recent items returned per request. */
const MAX_WISHLIST_ITEMS = 200;

export const GET = withErrorHandling(async () => {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data, error } = await supabase
    .from("wishlists")
    .select("id, product_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    // Bounded: nothing caps how many items a user can save, and an
    // unbounded select would fetch (and hydrate) all of them on every
    // page load.
    .limit(MAX_WISHLIST_ITEMS);

  if (error) throw error;

  const productIds = (data ?? []).map((row) => row.product_id);
  const products = await fetchProductsByIds(supabase, productIds);
  const productById = new Map(products.map((p) => [p.id, p]));

  const items: WishlistItem[] = (data ?? [])
    .map((row) => {
      const product = productById.get(row.product_id);
      if (!product) return null;
      return { id: row.id, product: { ...product, isWishlisted: true }, addedAt: row.created_at };
    })
    .filter((item): item is WishlistItem => item != null);

  return NextResponse.json(items);
});

const addSchema = z.object({ productId: z.string().uuid() });

export const POST = withErrorHandling(async (request: Request) => {
  const { productId } = addSchema.parse(await request.json());
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data, error } = await supabase
    .from("wishlists")
    // Idempotent: re-adding an already-wishlisted product succeeds instead
    // of erroring on the unique(user_id, product_id) constraint.
    .upsert({ user_id: user.id, product_id: productId }, { onConflict: "user_id,product_id" })
    .select("id, product_id, created_at")
    .single();

  if (error) throw error;

  const product = await fetchProductsByIds(supabase, [productId]);
  if (product.length === 0) {
    return NextResponse.json({ message: "Product not found" }, { status: 404 });
  }

  const item: WishlistItem = {
    id: data.id,
    product: { ...product[0], isWishlisted: true },
    addedAt: data.created_at,
  };

  return NextResponse.json(item, { status: 201 });
});
