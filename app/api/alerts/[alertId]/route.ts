import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertUuid, badRequest, notFound, withErrorHandling } from "@/lib/server/errors";
import { priceAlertUpdateSchema } from "@/lib/validation/user";
import { requireUser } from "@/lib/server/auth";
import { fetchProductsByIds } from "@/lib/server/products";
import type { PriceAlertRecord } from "@/lib/types";

interface RouteParams {
  params: Promise<{ alertId: string }>;
}



export const PATCH = withErrorHandling(async (request: Request, { params }: RouteParams) => {
  const { alertId } = await params;
  assertUuid(alertId, "alert id");
  const body = priceAlertUpdateSchema.parse(await request.json());
  if (body.active === undefined && body.targetPrice === undefined) {
    throw badRequest("Provide targetPrice and/or active");
  }
  const supabase = await createClient();
  const user = await requireUser(supabase);

  // Whitelisted columns only — user_id and product_id are deliberately not
  // updatable, so an alert can never be re-pointed at another account.
  const update: Record<string, unknown> = {};
  if (body.active !== undefined) update.is_active = body.active;
  if (body.targetPrice !== undefined) {
    update.target_price = body.targetPrice;
    // Editing the target starts a fresh trigger history: a previous
    // notification at the old target says nothing about the new one.
    update.last_triggered_at = null;
    update.last_triggered_price = null;
  }

  const { data, error } = await supabase
    .from("price_alerts")
    .update(update)
    .eq("id", alertId)
    .eq("user_id", user.id)
    .select("id, product_id, target_price, is_active, created_at")
    .single();

  if (error || !data) throw notFound("Alert not found");

  const [product] = await fetchProductsByIds(supabase, [data.product_id]);
  const { data: priceRows } = await supabase.rpc("get_current_prices", {
    p_product_ids: [data.product_id],
  });

  const record: PriceAlertRecord = {
    id: data.id,
    product,
    targetPrice: data.target_price,
    currentPrice: priceRows?.[0]?.current_price ?? 0,
    active: data.is_active,
    createdAt: data.created_at,
  };

  return NextResponse.json(record);
});

export const DELETE = withErrorHandling(async (_request: Request, { params }: RouteParams) => {
  const { alertId } = await params;
  assertUuid(alertId, "alert id");
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { error } = await supabase.from("price_alerts").delete().eq("id", alertId).eq("user_id", user.id);
  if (error) throw error;

  return new NextResponse(null, { status: 204 });
});
