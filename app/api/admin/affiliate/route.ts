import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { embeddedOne } from "@/lib/server/dbTypes";
import { requirePermission } from "@/lib/server/rbac";

/**
 * Affiliate analytics + configuration health.
 *
 * Note what is NOT returned: no tracking ID values, no credentials. The
 * config block returns only the env var NAME so an admin can verify it's
 * set correctly, never the secret itself.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const sessionSupabase = await createClient();
  await requirePermission(sessionSupabase, "manage_affiliate");

  const days = Number(new URL(request.url).searchParams.get("days")) || 30;
  const admin = createAdminClient();

  const [statsRes, healthRes, topRes, configRes] = await Promise.all([
    admin.rpc("get_affiliate_click_stats", { p_since_days: days }),
    admin.rpc("get_affiliate_link_health", { p_since_days: Math.min(days, 7) }),
    admin.rpc("get_top_clicked_products", { p_since_days: days, p_limit: 25 }),
    admin
      .from("affiliate_configurations")
      .select(
        `merchant_id, network, link_strategy, is_active, tracking_param,
         tracking_id_env_var, sub_id_param, campaign_param,
         allowed_deep_link_domains, merchants ( name )`,
      ),
  ]);

  if (statsRes.error) throw statsRes.error;
  if (healthRes.error) throw healthRes.error;
  if (topRes.error) throw topRes.error;
  if (configRes.error) throw configRes.error;

  const configs = (configRes.data ?? []).map((c) => {
    const envVar = c.tracking_id_env_var as string | null;
    return {
      merchantId: c.merchant_id,
      merchantName: embeddedOne<{ name: string }>(c.merchants)?.name ?? "Unknown",
      network: c.network,
      strategy: c.link_strategy,
      isActive: c.is_active,
      trackingParam: c.tracking_param,
      subIdParam: c.sub_id_param,
      campaignParam: c.campaign_param,
      allowedDomains: c.allowed_deep_link_domains ?? [],
      trackingIdEnvVar: envVar,
      // Whether the referenced env var is actually set — the single most
      // common misconfiguration. The VALUE is never returned.
      trackingIdConfigured: Boolean(envVar && process.env[envVar]),
    };
  });

  return NextResponse.json({
    periodDays: days,
    merchantStats: statsRes.data ?? [],
    linkHealth: healthRes.data ?? [],
    topProducts: topRes.data ?? [],
    configurations: configs,
  });
});
