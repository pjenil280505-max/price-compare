import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertUuid, badRequest, notFound, withErrorHandling } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/rbac";
import { recordAuditLog } from "@/lib/server/audit";

interface RouteParams {
  params: Promise<{ reviewId: string }>;
}

const patchSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().max(500).optional(),
});

/**
 * Approve or reject a proposed cross-merchant match.
 *
 * APPROVE performs a real merge: the incoming listing's product is folded
 * into the candidate product via merge_products(), which moves offers onto
 * the variant with the SAME SIGNATURE (creating it if needed) and writes a
 * reversible snapshot to product_merge_log.
 *
 * Note what approving does NOT do: it never edits product content, and it
 * cannot place two differing variant signatures on one variant row — the
 * unique index on (product_id, variant_signature) makes that impossible
 * regardless of what an admin clicks.
 */
export const PATCH = withErrorHandling(async (request: Request, { params }: RouteParams) => {
  const { reviewId } = await params;
  assertUuid(reviewId, "review id");

  const { decision, reason } = patchSchema.parse(await request.json());

  const sessionSupabase = await createClient();
  const adminUser = (await requirePermission(sessionSupabase, "review_matches")).user;
  const admin = createAdminClient();

  const { data: reviewRows, error: reviewError } = await admin
    .from("product_match_reviews")
    .select(
      `id, status, candidate_product_id, confidence_score, match_tier,
       merchant_offers ( id, product_variants ( id, product_id ) )`,
    )
    .eq("id", reviewId)
    .limit(1)
    .returns<
      {
        id: string;
        status: string;
        candidate_product_id: string;
        confidence_score: number;
        match_tier: string | null;
        merchant_offers: { id: string; product_variants: { id: string; product_id: string } | null } | null;
      }[]
    >();

  if (reviewError) throw reviewError;
  if (!reviewRows || reviewRows.length === 0) throw notFound("Review not found");

  const review = reviewRows[0];
  if (review.status !== "pending") {
    return NextResponse.json({ message: "This review has already been decided" }, { status: 409 });
  }

  let mergeLogId: string | null = null;

  if (decision === "approved") {
    const incomingProductId = review.merchant_offers?.product_variants?.product_id;
    if (!incomingProductId) {
      throw badRequest("The incoming offer is no longer linked to a product; nothing to merge.");
    }
    if (incomingProductId === review.candidate_product_id) {
      // Already merged by a prior action or an auto-merge that ran later.
      // Close the review rather than erroring.
      await admin
        .from("product_match_reviews")
        .update({ status: "merged", reviewed_by: adminUser.id, reviewed_at: new Date().toISOString() })
        .eq("id", reviewId);
      return NextResponse.json({ id: reviewId, status: "merged", mergeLogId: null });
    }

    const { data: logId, error: mergeError } = await admin.rpc("merge_products", {
      p_primary_product_id: review.candidate_product_id,
      p_secondary_product_id: incomingProductId,
      p_performed_by: adminUser.id,
      p_reason: reason ?? `Approved match review ${reviewId}`,
      p_action: "merge",
    });

    if (mergeError) throw mergeError;
    mergeLogId = logId as string;
  }

  const { data: updated, error: updateError } = await admin
    .from("product_match_reviews")
    .update({
      status: decision === "approved" ? "merged" : "rejected",
      reviewed_by: adminUser.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", reviewId)
    .eq("status", "pending")
    .select("id, status")
    .single();

  if (updateError || !updated) throw notFound("Review not found");

  await recordAuditLog(createAdminClient(), {
    actorId: adminUser.id,
    action: decision === "approved" ? "match.approved" : "match.rejected",
    targetTable: "product_match_reviews",
    targetId: reviewId,
    details: { candidateProductId: review.candidate_product_id, mergeLogId },
  });

  return NextResponse.json({ id: updated.id, status: updated.status, mergeLogId });
});
