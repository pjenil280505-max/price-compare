import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertUuid, badRequest, notFound, withErrorHandling } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/rbac";
import { recordAuditLog } from "@/lib/server/audit";

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

/** Keys that must never appear in sync_jobs.config, which every admin can read. */
const SECRET_LIKE_KEYS = ["token", "secret", "password", "apikey", "api_key", "credential", "key"];

export const PATCH = withErrorHandling(async (request: Request, { params }: RouteParams) => {
  const { jobId } = await params;
  assertUuid(jobId, "job id");

  const body = patchSchema.parse(await request.json());
  if (body.isActive === undefined && body.config === undefined) {
    throw badRequest("Provide isActive and/or config");
  }

  const sessionSupabase = await createClient();
  const adminUser = (await requirePermission(sessionSupabase, "manage_connectors")).user;

  if (body.config) {
    // Defense in depth against a well-meaning admin pasting a token into a
    // config field: sync_jobs.config is admin-readable, so a credential
    // stored here would be exposed to every admin and to the connectors
    // API response. Credentials belong in environment variables only.
    const offending = Object.keys(body.config).filter((key) =>
      SECRET_LIKE_KEYS.some((needle) => key.toLowerCase().includes(needle)),
    );
    if (offending.length > 0) {
      throw badRequest(
        `Config keys look like credentials and were rejected: ${offending.join(", ")}. ` +
          `Store secrets in environment variables named by the merchant's env_var_prefix instead.`,
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (body.isActive !== undefined) {
    update.is_active = body.isActive;
    // Re-enabling clears the backoff counter — the admin is asserting the
    // underlying problem is fixed.
    if (body.isActive) update.consecutive_failures = 0;
  }
  if (body.config !== undefined) update.config = body.config;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sync_jobs")
    .update(update)
    .eq("id", jobId)
    .select("id, is_active, config")
    .single();

  if (error || !data) throw notFound("Connector job not found");

  await recordAuditLog(admin, {
    actorId: adminUser.id,
    action: body.isActive === undefined
      ? "connector.config_updated"
      : body.isActive ? "connector.enabled" : "connector.disabled",
    targetTable: "sync_jobs",
    targetId: jobId,
    details: { changedKeys: Object.keys(update) },
  });

  return NextResponse.json({ jobId: data.id, isActive: data.is_active, config: data.config });
});
