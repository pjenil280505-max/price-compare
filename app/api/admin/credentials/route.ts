import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/rbac";
import { listConnectors } from "@/lib/connectors/registry";

/**
 * API credentials status.
 *
 * THIS ENDPOINT NEVER RETURNS A CREDENTIAL VALUE. It reports which
 * environment variables each merchant's connector and affiliate config
 * expect, and whether each is currently set — the only thing an operator
 * needs to diagnose a misconfiguration.
 *
 * Gated behind its own `view_credentials` permission (superadmin only by
 * default) rather than generic admin access, because even knowing WHICH
 * variables exist is worth restricting.
 */
export const GET = withErrorHandling(async () => {
  const sessionSupabase = await createClient();
  await requirePermission(sessionSupabase, "view_credentials");

  const admin = createAdminClient();

  const [jobsRes, affiliateRes] = await Promise.all([
    admin.from("sync_jobs").select("id, connector_key, merchant_id, merchants ( name )").limit(200),
    admin
      .from("affiliate_configurations")
      .select("merchant_id, network, env_var_prefix, tracking_id_env_var, is_active, merchants ( name )"),
  ]);

  if (jobsRes.error) throw jobsRes.error;
  if (affiliateRes.error) throw affiliateRes.error;

  const registry = new Map(listConnectors().map((c) => [c.key, c]));

  const connectorCredentials = (jobsRes.data ?? []).map((job) => {
    const connector = registry.get(job.connector_key as string);
    const prefix =
      (affiliateRes.data ?? []).find((a) => a.merchant_id === job.merchant_id)?.env_var_prefix ?? null;

    const required = (connector?.requiredCredentials ?? []).map((name) => {
      const envVar = prefix ? `${prefix}_${name}` : name;
      return {
        envVar,
        // Presence only — the value is never read into the response.
        configured: Boolean(process.env[envVar]),
      };
    });

    return {
      merchantName: (job.merchants as { name: string } | null)?.name ?? "Unknown",
      connectorKey: job.connector_key,
      connectorRegistered: Boolean(connector),
      envVarPrefix: prefix,
      required,
      allConfigured: required.length > 0 && required.every((r) => r.configured),
    };
  });

  const affiliateCredentials = (affiliateRes.data ?? []).map((cfg) => ({
    merchantName: (cfg.merchants as { name: string } | null)?.name ?? "Unknown",
    network: cfg.network,
    isActive: cfg.is_active,
    trackingIdEnvVar: cfg.tracking_id_env_var,
    configured: Boolean(cfg.tracking_id_env_var && process.env[cfg.tracking_id_env_var as string]),
  }));

  return NextResponse.json({ connectorCredentials, affiliateCredentials });
});
