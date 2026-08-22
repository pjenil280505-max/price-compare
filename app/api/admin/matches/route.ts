import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/rbac";

interface ReviewRow {
  id: string;
  merchant_offer_id: string;
  candidate_product_id: string;
  confidence_score: number;
  match_tier: string | null;
  proposed_variant_signature: string | null;
  subject_snapshot: Record<string, unknown>;
  conflicts: { axis: string; left: string; right: string; severity: string }[];
  reasons: string[];
  status: string;
  created_at: string;
  merchant_offers: {
    id: string;
    external_product_id: string;
    destination_url: string;
    merchants: { name: string } | null;
    product_variants: {
      id: string;
      label: string;
      variant_signature: string;
      products: { id: string; title: string; slug: string; primary_image_url: string } | null;
    } | null;
  } | null;
  products: { id: string; title: string; slug: string; primary_image_url: string } | null;
}

export const GET = withErrorHandling(async (request: Request) => {
  const status = new URL(request.url).searchParams.get("status") ?? "pending";

  const sessionSupabase = await createClient();
  await requirePermission(sessionSupabase, "review_matches");
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("product_match_reviews")
    .select(
      `id, merchant_offer_id, candidate_product_id, confidence_score, match_tier,
       proposed_variant_signature, subject_snapshot, conflicts, reasons, status, created_at,
       merchant_offers (
         id, external_product_id, destination_url,
         merchants ( name ),
         product_variants (
           id, label, variant_signature,
           products ( id, title, slug, primary_image_url )
         )
       ),
       products!product_match_reviews_candidate_product_id_fkey (
         id, title, slug, primary_image_url
       )`,
    )
    .eq("status", status)
    .order("confidence_score", { ascending: false })
    .limit(100)
    .returns<ReviewRow[]>();

  if (error) throw error;

  const reviews = (data ?? []).map((row) => ({
    id: row.id,
    confidence: row.confidence_score,
    tier: row.match_tier,
    status: row.status,
    createdAt: row.created_at,
    conflicts: row.conflicts ?? [],
    reasons: row.reasons ?? [],
    proposedVariantSignature: row.proposed_variant_signature,
    // The incoming listing (as its own newly-created product).
    incoming: {
      offerId: row.merchant_offer_id,
      merchantName: row.merchant_offers?.merchants?.name ?? "Unknown",
      externalId: row.merchant_offers?.external_product_id ?? "",
      productId: row.merchant_offers?.product_variants?.products?.id ?? null,
      title: row.merchant_offers?.product_variants?.products?.title ?? "",
      imageUrl: row.merchant_offers?.product_variants?.products?.primary_image_url ?? "",
      variantLabel: row.merchant_offers?.product_variants?.label ?? "",
      snapshot: row.subject_snapshot ?? {},
    },
    // The existing product it might be the same as.
    candidate: {
      productId: row.candidate_product_id,
      title: row.products?.title ?? "",
      slug: row.products?.slug ?? "",
      imageUrl: row.products?.primary_image_url ?? "",
    },
  }));

  return NextResponse.json({ reviews });
});
