import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { assertInternalRequest } from "@/lib/server/auth";

/**
 * Storage-maintenance job: collapses raw price_history older than the
 * retention window into daily aggregates and drops the raw rows.
 *
 * Without this, price_history grows by (offers × sync frequency) forever
 * and becomes the binding constraint on free-tier storage. Runs weekly —
 * see .github/workflows/price-rollup.yml.
 */
export const POST = withErrorHandling(async (request: Request) => {
  assertInternalRequest(request);

  const retainDays = Number(new URL(request.url).searchParams.get("retainDays")) || 90;
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("rollup_price_history", { p_retain_days: retainDays });
  if (error) throw error;

  const result = (data ?? [])[0] as { days_rolled: number; rows_collapsed: number } | undefined;

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    retainDays,
    daysRolled: result?.days_rolled ?? 0,
    rowsCollapsed: result?.rows_collapsed ?? 0,
  });
});
