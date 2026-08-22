import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { requireUser } from "@/lib/server/auth";
import { recentlyViewedSchema } from "@/lib/validation/user";
import { fetchProductsByIds } from "@/lib/server/products";

const MAX_RETURNED = 20;

export const GET = withErrorHandling(async () => {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data, error } = await supabase
    .from("recently_viewed")
    .select("product_id, viewed_at")
    .eq("user_id", user.id)
    .order("viewed_at", { ascending: false })
    .limit(MAX_RETURNED);

  if (error) throw error;

  const ids = (data ?? []).map((r) => r.product_id as string);
  const products = await fetchProductsByIds(supabase, ids);

  return NextResponse.json(products);
});

/**
 * Records a view. Upsert on the composite primary key, so re-viewing a
 * product refreshes its timestamp instead of appending to a visit log —
 * the feature needs "what did I look at", not "how many times".
 *
 * Silently no-ops for signed-out visitors rather than erroring: browsing
 * history is a convenience, and anonymous browsing must not be tracked.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const { productId } = recentlyViewedSchema.parse(await request.json());

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ recorded: false });

  const { error } = await supabase
    .from("recently_viewed")
    .upsert(
      { user_id: user.id, product_id: productId, viewed_at: new Date().toISOString() },
      { onConflict: "user_id,product_id" },
    );

  if (error) throw error;
  return NextResponse.json({ recorded: true });
});

export const DELETE = withErrorHandling(async () => {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { error } = await supabase.from("recently_viewed").delete().eq("user_id", user.id);
  if (error) throw error;

  return new NextResponse(null, { status: 204 });
});
