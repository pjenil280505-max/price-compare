import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { embeddedOne } from "@/lib/server/dbTypes";
import { requirePermission } from "@/lib/server/rbac";

/**
 * Failed sync runs and the per-record failures within them.
 *
 * raw_payload is deliberately NOT returned. It is merchant feed data
 * captured for debugging and can be large; the reason and external id are
 * what an operator actually acts on.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const sessionSupabase = await createClient();
  await requirePermission(sessionSupabase, "manage_connectors");

  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const admin = createAdminClient();

  const [runsRes, failuresRes] = await Promise.all([
    admin
      .from("sync_logs")
      .select("id, status, started_at, finished_at, items_processed, items_flagged, error_message, sync_jobs ( merchants ( name ) )")
      .eq("status", "error")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(25),
    admin
      .from("sync_failures")
      .select("id, external_product_id, stage, reason, created_at, sync_logs ( sync_jobs ( merchants ( name ) ) )")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (runsRes.error) throw runsRes.error;
  if (failuresRes.error) throw failuresRes.error;

  const failedRuns = (runsRes.data ?? []).map((r) => ({
    id: r.id,
    merchant:
      embeddedOne<{ name: string }>(
        embeddedOne<{ merchants: unknown }>(r.sync_jobs)?.merchants,
      )?.name ?? "Unknown",
    startedAt: r.started_at,
    itemsProcessed: r.items_processed,
    itemsFlagged: r.items_flagged,
    // Truncated: error_message holds the tail of the run log and can be long.
    error: typeof r.error_message === "string" ? r.error_message.slice(0, 600) : null,
  }));

  const recordFailures = (failuresRes.data ?? []).map((f) => ({
    id: f.id,
    externalId: f.external_product_id,
    stage: f.stage,
    reason: typeof f.reason === "string" ? f.reason.slice(0, 300) : "",
    createdAt: f.created_at,
    merchant:
      embeddedOne<{ name: string }>(
        embeddedOne<{ merchants: unknown }>(
          embeddedOne<{ sync_jobs: unknown }>(f.sync_logs)?.sync_jobs,
        )?.merchants,
      )?.name ?? "Unknown",
  }));

  // Group by reason so the operator sees "500 items failed for ONE reason",
  // not 500 near-identical rows.
  const byReason = new Map<string, { reason: string; stage: string; count: number; example: string | null }>();
  for (const f of recordFailures) {
    const key = `${f.stage}:${f.reason}`;
    const existing = byReason.get(key);
    if (existing) existing.count += 1;
    else byReason.set(key, { reason: f.reason, stage: f.stage, count: 1, example: f.externalId });
  }

  return NextResponse.json({
    periodDays: days,
    failedRuns,
    failureGroups: [...byReason.values()].sort((a, b) => b.count - a.count),
    totalRecordFailures: recordFailures.length,
  });
});
