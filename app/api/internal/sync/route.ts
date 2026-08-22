import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { assertInternalRequest } from "@/lib/server/auth";
import { runSync } from "@/lib/server/sync/engine";

/**
 * Scheduled sync entry point, called by GitHub Actions cron (see
 * .github/workflows/sync-connectors.yml). Authenticated by the
 * INTERNAL_CRON_SECRET shared secret — there is no user session here.
 *
 * Picks jobs that are due, runs them sequentially within a time budget, and
 * returns a summary. Sequential rather than parallel: several connectors
 * hammering the database and merchant APIs simultaneously is how you get
 * rate-limited by a merchant and throttled by Supabase at the same time.
 */

const RUN_BUDGET_MS = 4 * 60 * 1000;
const MAX_JOBS_PER_INVOCATION = 4;

/** After this many consecutive failures, a job is skipped until an admin re-enables it. */
const FAILURE_BACKOFF_THRESHOLD = 5;

interface DueJob {
  id: string;
  job_type: string;
  next_run_at: string | null;
  consecutive_failures: number;
  merchants: { name: string } | null;
}

export const POST = withErrorHandling(async (request: Request) => {
  assertInternalRequest(request);

  const admin = createAdminClient();
  const now = new Date();

  const { data: jobs, error } = await admin
    .from("sync_jobs")
    .select("id, job_type, next_run_at, consecutive_failures, merchants ( name )")
    .eq("is_active", true)
    .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`)
    .order("next_run_at", { ascending: true, nullsFirst: true })
    .limit(MAX_JOBS_PER_INVOCATION)
    .returns<DueJob[]>();

  if (error) throw error;

  const results: Record<string, unknown>[] = [];
  const deadline = Date.now() + RUN_BUDGET_MS;

  for (const job of jobs ?? []) {
    if (Date.now() >= deadline) {
      results.push({ jobId: job.id, skipped: "invocation budget exhausted" });
      continue;
    }

    if (job.consecutive_failures >= FAILURE_BACKOFF_THRESHOLD) {
      results.push({
        jobId: job.id,
        merchant: job.merchants?.name,
        skipped: `${job.consecutive_failures} consecutive failures — needs admin attention`,
      });
      continue;
    }

    try {
      const remaining = deadline - Date.now();
      const result = await runSync({
        syncJobId: job.id,
        timeBudgetMs: Math.max(30_000, remaining),
        triggeredBy: "scheduler",
      });
      results.push({ jobId: job.id, merchant: job.merchants?.name, ...result });
    } catch (err) {
      results.push({
        jobId: job.id,
        merchant: job.merchants?.name,
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ ranAt: now.toISOString(), jobsConsidered: jobs?.length ?? 0, results });
});
