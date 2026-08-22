import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertUuid, badRequest, withErrorHandling } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/rbac";
import { recordAuditLog } from "@/lib/server/audit";
import { runSync } from "@/lib/server/sync/engine";

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

const bodySchema = z.object({
  mode: z.enum(["full_catalog", "delta_price", "delta_stock"]).optional(),
});

/**
 * "Sync Now" — runs a connector immediately, inline.
 *
 * Inline rather than queued because this stack has no worker/queue tier: a
 * background job would need infrastructure that doesn't exist yet. The
 * engine's time budget keeps the request inside typical serverless limits,
 * and any unfinished work resumes from the persisted cursor on the next
 * run, so a large catalog completes across several invocations rather than
 * in one long request.
 */
export const POST = withErrorHandling(async (request: Request, { params }: RouteParams) => {
  const { jobId } = await params;
  assertUuid(jobId, "job id");

  const raw = await request.json().catch(() => ({}));
  const { mode } = bodySchema.parse(raw);

  const sessionSupabase = await createClient();
  const adminUser = (await requirePermission(sessionSupabase, "manage_connectors")).user;

  // Concurrency guard: a second "Sync Now" while one is already running
  // would double-write and corrupt cursor checkpointing.
  const admin = createAdminClient();
  const { data: running, error: runningError } = await admin
    .from("sync_logs")
    .select("id, started_at")
    .eq("sync_job_id", jobId)
    .eq("status", "running")
    .limit(1);

  if (runningError) throw runningError;

  if (running && running.length > 0) {
    const startedAt = new Date(running[0].started_at).getTime();
    const ageMinutes = (Date.now() - startedAt) / 60_000;

    // A run older than 30 minutes is almost certainly a crashed invocation
    // whose log was never closed — mark it failed so it stops blocking.
    if (ageMinutes < 30) {
      throw badRequest("A sync is already running for this connector.");
    }

    await admin
      .from("sync_logs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: "Run abandoned — no completion recorded within 30 minutes.",
      })
      .eq("id", running[0].id);
  }

  await recordAuditLog(admin, {
    actorId: adminUser.id,
    action: "connector.sync_now",
    targetTable: "sync_jobs",
    targetId: jobId,
    details: { mode: mode ?? "default" },
  });

  const result = await runSync({
    syncJobId: jobId,
    mode,
    triggeredBy: adminUser.email ?? adminUser.id,
  });

  return NextResponse.json(result, { status: result.status === "success" ? 200 : 500 });
});
