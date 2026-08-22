import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { embeddedOne } from "@/lib/server/dbTypes";
import { requirePermission } from "@/lib/server/rbac";
import { listConnectors } from "@/lib/connectors/registry";
import { isEmailConfigured } from "@/lib/notifications/email";
import { isPushConfigured } from "@/lib/notifications/push";

/**
 * System health.
 *
 * Reports what is configured, what is running, and what is broken — in one
 * request, because this is the page an operator opens on a phone when
 * something looks wrong.
 *
 * Environment variables are reported as SET or NOT SET only. No value is
 * ever returned.
 */
export const GET = withErrorHandling(async () => {
  const sessionSupabase = await createClient();
  await requirePermission(sessionSupabase, "view_dashboard");

  const admin = createAdminClient();
  const startedAt = Date.now();

  // --- Database reachability + latency -------------------------------
  const { error: dbError } = await admin.from("merchants").select("id", { head: true, count: "exact" }).limit(1);
  const dbLatencyMs = Date.now() - startedAt;

  const [
    merchantsRes, jobsRes, runningRes, recentRunsRes, failuresRes,
    staleRes, affiliateRes, clickHealthRes, deliveryRes, alertsRes,
  ] = await Promise.all([
    admin.rpc("get_merchant_summary"),
    admin.from("sync_jobs").select("id, is_active, last_run_at, consecutive_failures").eq("is_active", true),
    admin.from("sync_logs").select("id, started_at").eq("status", "running").limit(20),
    admin.from("sync_logs")
      .select("id, status, started_at, items_processed, items_matched, items_flagged, sync_jobs ( merchants ( name ) )")
      .order("started_at", { ascending: false }).limit(10),
    admin.from("sync_logs").select("id", { count: "exact", head: true })
      .eq("status", "error").gte("started_at", new Date(Date.now() - 7 * 86_400_000).toISOString()),
    admin.rpc("get_stale_offers", { p_limit: 20 }),
    admin.from("affiliate_configurations")
      .select("merchant_id, network, is_active, tracking_id_env_var, merchants ( name )"),
    admin.rpc("get_affiliate_link_health", { p_since_days: 7 }),
    admin.from("notification_deliveries").select("status"),
    admin.from("price_alerts").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);

  // --- Services -------------------------------------------------------
  const services = [
    { name: "Database", ok: !dbError, detail: dbError ? "unreachable" : `${dbLatencyMs}ms`, critical: true },
    { name: "Supabase URL", ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL), critical: true },
    { name: "Service role key", ok: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), critical: true },
    { name: "Site URL", ok: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
      detail: "canonical links, emails", critical: true },
    { name: "Cron secret", ok: Boolean(process.env.INTERNAL_CRON_SECRET),
      detail: "scheduled jobs", critical: true },
    { name: "Email delivery", ok: isEmailConfigured(), detail: "price alert emails", critical: false },
    { name: "Unsubscribe signing", ok: Boolean(process.env.NOTIFICATION_TOKEN_SECRET),
      detail: "falls back to service key", critical: false },
    { name: "AI assistant", ok: Boolean(process.env.ANTHROPIC_API_KEY), critical: false },
    { name: "Web push", ok: isPushConfigured(), detail: "sending not implemented", critical: false },
    { name: "Contact address", ok: Boolean(process.env.NEXT_PUBLIC_CONTACT_EMAIL), critical: false },
  ];

  // --- Sync --------------------------------------------------------
  const jobs = jobsRes.data ?? [];
  const stuckRuns = (runningRes.data ?? []).filter(
    (r) => Date.now() - new Date(r.started_at as string).getTime() > 30 * 60_000,
  );

  const recentRuns = (recentRunsRes.data ?? []).map((r) => ({
    id: r.id,
    merchant: embeddedOne<{ name: string }>(
      embeddedOne<{ merchants: unknown }>(r.sync_jobs)?.merchants,
    )?.name ?? "Unknown",
    status: r.status,
    startedAt: r.started_at,
    itemsProcessed: r.items_processed,
    itemsMatched: r.items_matched,
    itemsFlagged: r.items_flagged,
  }));

  const lastSuccess = recentRuns.find((r) => r.status === "success") ?? null;

  // --- Merchants ---------------------------------------------------
  type MerchantRow = {
    merchant_id: string; name: string; is_active: boolean;
    offer_count: number; product_count: number; fresh_offers: number; stale_offers: number;
    sync_job_id: string | null; sync_active: boolean | null;
    last_run_at: string | null; consecutive_failures: number;
    affiliate_network: string | null; affiliate_active: boolean | null;
  };
  const merchants = ((merchantsRes.data ?? []) as MerchantRow[]).map((m) => ({
    id: m.merchant_id,
    name: m.name,
    isActive: m.is_active,
    productCount: m.product_count,
    offerCount: m.offer_count,
    freshOffers: m.fresh_offers,
    staleOffers: m.stale_offers,
    connected: Boolean(m.sync_job_id),
    syncActive: Boolean(m.sync_active),
    lastRunAt: m.last_run_at,
    consecutiveFailures: m.consecutive_failures,
    affiliateNetwork: m.affiliate_network,
    affiliateActive: Boolean(m.affiliate_active),
  }));

  // --- Affiliate ---------------------------------------------------
  const affiliateConfigs = (affiliateRes.data ?? []).map((c) => ({
    merchantName: embeddedOne<{ name: string }>(c.merchants)?.name ?? "Unknown",
    network: c.network,
    isActive: c.is_active,
    // Presence only — never the value.
    credentialSet: Boolean(c.tracking_id_env_var && process.env[c.tracking_id_env_var as string]),
  }));

  // --- Notifications -----------------------------------------------
  const deliveryRows = (deliveryRes.data ?? []) as { status: string }[];
  const deliveryCounts = deliveryRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    services,
    connectors: listConnectors().map((c) => ({
      key: c.key,
      displayName: c.displayName,
      implemented: c.supportedModes.length > 0,
    })),
    merchants,
    sync: {
      activeJobs: jobs.length,
      neverRun: jobs.filter((j) => !j.last_run_at).length,
      backedOff: jobs.filter((j) => (j.consecutive_failures as number) >= 5).length,
      stuckRuns: stuckRuns.length,
      failedLast7Days: failuresRes.count ?? 0,
      lastSuccessfulRun: lastSuccess,
      recentRuns,
    },
    imports: {
      totalProducts: merchants.reduce((s, m) => s + m.productCount, 0),
      totalOffers: merchants.reduce((s, m) => s + m.offerCount, 0),
      staleOffers: merchants.reduce((s, m) => s + m.staleOffers, 0),
      staleSample: (staleRes.data ?? []).slice(0, 5),
    },
    affiliate: {
      configs: affiliateConfigs,
      linkFailures: clickHealthRes.data ?? [],
    },
    notifications: {
      emailConfigured: isEmailConfigured(),
      pushConfigured: isPushConfigured(),
      activeAlerts: alertsRes.count ?? 0,
      deliveries: deliveryCounts,
    },
  });
});
