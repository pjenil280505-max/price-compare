import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { badRequest, withErrorHandling } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/rbac";

/** GET — the merge audit log. Every merge/unmerge, who did it, and why. */
export const GET = withErrorHandling(async () => {
  const sessionSupabase = await createClient();
  await requirePermission(sessionSupabase, "merge_products");
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("product_merge_log")
    .select(
      `id, action, primary_product_id, secondary_product_id, match_tier, confidence,
       reason, created_at, performed_by,
       primary:products!product_merge_log_primary_product_id_fkey ( title, slug ),
       secondary:products!product_merge_log_secondary_product_id_fkey ( title, slug )`,
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  // Which merges have already been reversed, so the UI can hide "Undo".
  const reversedIds = new Set(
    (data ?? [])
      .filter((row) => row.action === "unmerge")
      .map((row) => {
        const match = /Reversal of merge ([0-9a-f-]{36})/.exec(row.reason ?? "");
        return match?.[1];
      })
      .filter(Boolean) as string[],
  );

  const entries = (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    primaryTitle: (row.primary as { title?: string } | null)?.title ?? null,
    secondaryTitle: (row.secondary as { title?: string } | null)?.title ?? null,
    matchTier: row.match_tier,
    confidence: row.confidence,
    reason: row.reason,
    createdAt: row.created_at,
    canUndo: row.action !== "unmerge" && !reversedIds.has(row.id),
  }));

  return NextResponse.json({ entries });
});

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("merge"),
    primaryProductId: z.string().uuid(),
    secondaryProductId: z.string().uuid(),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("unmerge"),
    mergeLogId: z.string().uuid(),
  }),
]);

/** POST — manual merge, or unmerge (undo) of a previous merge. */
export const POST = withErrorHandling(async (request: Request) => {
  const body = postSchema.parse(await request.json());

  const sessionSupabase = await createClient();
  const adminUser = (await requirePermission(sessionSupabase, "merge_products")).user;
  const admin = createAdminClient();

  if (body.action === "merge") {
    if (body.primaryProductId === body.secondaryProductId) {
      throw badRequest("Cannot merge a product into itself");
    }
    const { data, error } = await admin.rpc("merge_products", {
      p_primary_product_id: body.primaryProductId,
      p_secondary_product_id: body.secondaryProductId,
      p_performed_by: adminUser.id,
      p_reason: body.reason ?? "Manual merge",
      p_action: "merge",
    });
    if (error) throw badRequest(error.message);
    return NextResponse.json({ mergeLogId: data }, { status: 201 });
  }

  const { data, error } = await admin.rpc("unmerge_products", {
    p_merge_log_id: body.mergeLogId,
    p_performed_by: adminUser.id,
  });
  if (error) throw badRequest(error.message);
  return NextResponse.json({ unmergeLogId: data }, { status: 201 });
});
