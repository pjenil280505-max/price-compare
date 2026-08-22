import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertUuid, withErrorHandling } from "@/lib/server/errors";
import { requireUser } from "@/lib/server/auth";

interface RouteParams {
  params: Promise<{ productId: string }>;
}

export const DELETE = withErrorHandling(async (_request: Request, { params }: RouteParams) => {
  const { productId } = await params;
  assertUuid(productId, "product id");
  const supabase = await createClient();
  const user = await requireUser(supabase);

  // RLS (wishlists_delete_own) already scopes this to the caller's own
  // rows — the explicit .eq("user_id", ...) here is defense in depth, not
  // the only thing preventing a cross-user delete.
  const { error } = await supabase
    .from("wishlists")
    .delete()
    .eq("user_id", user.id)
    .eq("product_id", productId);

  if (error) throw error;

  return new NextResponse(null, { status: 204 });
});
