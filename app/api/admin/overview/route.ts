import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/rbac";
import type { AdminOverview, ConnectorStatus } from "@/lib/types";

/** last_run_at older than this counts as "degraded" even if its last run succeeded. */
const STALE_AFTER_HOURS = 26;

export const GET = withErrorHandling(async () => {
  // requirePermission runs against the session-bound client — this is the real
  // authorization check. The admin (service-role) client below is used
  // only afterward, purely to run the cross-table aggregation efficiently;
  // it does not grant access on its own.
  const sessionSupabase = await createClient();
  await requirePermission(sessionSupabase, "view_dashboard");

  const admin = createAdminClient();

  const [jobsRes, logsRes, pendingRes] = await Promise.all([
    admin.from("sync_jobs").select("id, merchant_id, is_active, last_run_at, merchants(name)"),
    admin
      .from("sync_logs")
      .select("id, sync_job_id, status, started_at, items_processed, items_flagged, sync_jobs(merchants(name))")
      .order("started_at", { ascending: false })
      .limit(20),
    admin.from("product_match_reviews").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  if (jobsRes.error) throw jobsRes.error;
  if (logsRes.error) throw logsRes.error;
  if (pendingRes.error) throw pendingRes.error;

  const staleCutoff = Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000;

  // logsRes is already ordered newest-first, so the first log matching a
  // given sync_job_id is that job's most recent run — reused here instead
  // of an extra query per connector.
  const latestItemsByJobId = new Map<string, number>();
  for (const log of logsRes.data ?? []) {
    if (!latestItemsByJobId.has(log.sync_job_id)) {
      latestItemsByJobId.set(log.sync_job_id, log.items_processed);
    }
  }

  const connectors = (jobsRes.data ?? []).map((job) => {
    const merchantName = (job.merchants as { name: string } | null)?.name ?? "Unknown merchant";
    const lastRunAt = job.last_run_at;
    let status: ConnectorStatus = "down";
    if (!job.is_active) status = "down";
    else if (lastRunAt && new Date(lastRunAt).getTime() > staleCutoff) status = "healthy";
    else if (lastRunAt) status = "degraded";

    return {
      id: job.id,
      merchantName,
      status,
      lastSyncAt: lastRunAt ?? new Date(0).toISOString(),
      itemsSynced: latestItemsByJobId.get(job.id) ?? 0,
    };
  });

  const recentRuns = (logsRes.data ?? []).map((log) => ({
    id: log.id,
    connectorName: (log.sync_jobs as { merchants: { name: string } | null } | null)?.merchants?.name ?? "Unknown",
    status: log.status as "success" | "error" | "running",
    startedAt: log.started_at,
    itemsProcessed: log.items_processed,
    itemsFlagged: log.items_flagged,
  }));

  const overview: AdminOverview = {
    connectors,
    pendingMatchReviews: pendingRes.count ?? 0,
    recentRuns,
  };

  return NextResponse.json(overview);
});
