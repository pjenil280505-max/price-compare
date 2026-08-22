import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/rbac";
import { describeConnectors } from "@/lib/connectors/registry";

interface JobRow {
  id: string;
  merchant_id: string;
  job_type: string;
  connector_key: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  consecutive_failures: number;
  config: Record<string, unknown>;
  merchants: { name: string; slug: string } | null;
}

export const GET = withErrorHandling(async () => {
  const sessionSupabase = await createClient();
  await requirePermission(sessionSupabase, "manage_connectors");

  const admin = createAdminClient();

  const [jobsRes, logsRes] = await Promise.all([
    admin
      .from("sync_jobs")
      .select(
        "id, merchant_id, job_type, connector_key, is_active, last_run_at, next_run_at, consecutive_failures, config, merchants ( name, slug )",
      )
      .order("created_at", { ascending: true })
      .returns<JobRow[]>(),
    admin
      .from("sync_logs")
      .select("id, sync_job_id, status, started_at, finished_at, items_processed, items_matched, items_flagged")
      .order("started_at", { ascending: false })
      .limit(60),
  ]);

  if (jobsRes.error) throw jobsRes.error;
  if (logsRes.error) throw logsRes.error;

  // logsRes is newest-first, so the first match per job is its latest run.
  const latestByJob = new Map<string, (typeof logsRes.data)[number]>();
  for (const log of logsRes.data ?? []) {
    if (!latestByJob.has(log.sync_job_id)) latestByJob.set(log.sync_job_id, log);
  }

  const registry = new Map(describeConnectors().map((c) => [c.key, c]));

  const connectors = (jobsRes.data ?? []).map((job) => {
    const info = registry.get(job.connector_key);
    const latest = latestByJob.get(job.id);

    return {
      jobId: job.id,
      merchantName: job.merchants?.name ?? "Unknown merchant",
      connectorKey: job.connector_key,
      connectorName: info?.displayName ?? `Unregistered (${job.connector_key})`,
      isRegistered: Boolean(info),
      isImplemented: info?.isImplemented ?? false,
      jobType: job.job_type,
      isActive: job.is_active,
      lastRunAt: job.last_run_at,
      nextRunAt: job.next_run_at,
      consecutiveFailures: job.consecutive_failures,
      requiredCredentials: info?.requiredCredentials ?? [],
      latestRun: latest
        ? {
            id: latest.id,
            status: latest.status,
            startedAt: latest.started_at,
            finishedAt: latest.finished_at,
            itemsProcessed: latest.items_processed,
            itemsMatched: latest.items_matched,
            itemsFlagged: latest.items_flagged,
          }
        : null,
    };
  });

  return NextResponse.json({ connectors, available: describeConnectors() });
});
