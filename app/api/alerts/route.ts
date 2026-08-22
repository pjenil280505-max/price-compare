import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { badRequest, withErrorHandling } from "@/lib/server/errors";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { priceAlertSchema } from "@/lib/validation/user";
import { requireUser } from "@/lib/server/auth";
import { fetchProductsByIds } from "@/lib/server/products";
import type { PriceAlertRecord, Product } from "@/lib/types";

export const GET = withErrorHandling(async () => {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: alertRows, error } = await supabase
    .from("price_alerts")
    .select("id, product_id, target_price, is_active, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!alertRows || alertRows.length === 0) return NextResponse.json<PriceAlertRecord[]>([]);

  const productIds = alertRows.map((a) => a.product_id);

  const [products, currentPricesRes] = await Promise.all([
    fetchProductsByIds(supabase, productIds),
    supabase.rpc("get_current_prices", { p_product_ids: productIds }),
  ]);

  if (currentPricesRes.error) throw currentPricesRes.error;

  const productById = new Map<string, Product>(products.map((p) => [p.id, p]));
  const currentPriceByProductId = new Map<string, number>(
    (currentPricesRes.data ?? []).map((row: { product_id: string; current_price: number }) => [
      row.product_id,
      row.current_price,
    ]),
  );

  const records: PriceAlertRecord[] = alertRows
    .map((row): PriceAlertRecord | null => {
      const product = productById.get(row.product_id);
      if (!product) return null;
      return {
        id: row.id,
        product,
        targetPrice: row.target_price,
        currentPrice: currentPriceByProductId.get(row.product_id) ?? 0,
        active: row.is_active,
        createdAt: row.created_at,
      };
    })
    .filter((r): r is PriceAlertRecord => r != null);

  return NextResponse.json(records);
});



const MAX_ALERTS_PER_USER = 100;

export const POST = withErrorHandling(async (request: Request) => {
  // Bounded per-IP so a script cannot mass-create alerts.
  enforceRateLimit(request, { key: "alerts-create", limit: 30, windowMs: 60_000 });

  const body = priceAlertSchema.parse(await request.json());
  const supabase = await createClient();
  const user = await requireUser(supabase);

  // Explicit check-then-write rather than .upsert()'s onConflict: the DB's
  // duplicate-prevention index (0006_engagement.sql) is an EXPRESSION index
  // (coalesce(product_variant_id, sentinel)) because plain
  // UNIQUE(user_id, product_id, product_variant_id) doesn't dedupe
  // NULL-variant rows. PostgREST's on_conflict parameter matches plain
  // column names against an index, not arbitrary expressions, so it can't
  // target that index directly — hence doing the lookup explicitly here.
  // The unique index still backstops this against a genuine race.
  let existingQuery = supabase
    .from("price_alerts")
    .select("id")
    .eq("user_id", user.id)
    .eq("product_id", body.productId);

  existingQuery = body.variantId
    ? existingQuery.eq("product_variant_id", body.variantId)
    : existingQuery.is("product_variant_id", null);

  const { data: existing, error: lookupError } = await existingQuery.limit(1);
  if (lookupError) throw lookupError;

  // Per-account cap. Rate limiting alone is per-IP and resets; this bounds
  // total rows one account can create, which is what actually protects the
  // alert-evaluation job from being swamped.
  if (!existing || existing.length === 0) {
    const { count, error: countError } = await supabase
      .from("price_alerts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_ALERTS_PER_USER) {
      throw badRequest(`You can have at most ${MAX_ALERTS_PER_USER} price alerts. Remove one to add another.`);
    }
  }

  const payload = {
    user_id: user.id,
    product_id: body.productId,
    product_variant_id: body.variantId ?? null,
    target_price: body.targetPrice,
    is_active: body.active,
  };

  const { data, error } =
    existing && existing.length > 0
      ? await supabase
          .from("price_alerts")
          .update(payload)
          .eq("id", existing[0].id)
          .select("id, product_id, product_variant_id, target_price, is_active")
          .single()
      : await supabase
          .from("price_alerts")
          .insert(payload)
          .select("id, product_id, product_variant_id, target_price, is_active")
          .single();

  if (error) throw error;

  return NextResponse.json(
    {
      id: data.id,
      productId: data.product_id,
      variantId: data.product_variant_id ?? undefined,
      targetPrice: data.target_price,
      active: data.is_active,
    },
    { status: 201 },
  );
});
