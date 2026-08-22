import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAffiliateLink,
  containsCredentialLeak,
  type AffiliateConfig,
  type BuiltLink,
  type LinkContext,
  type LinkStrategy,
} from "./linkBuilder";

/**
 * Resolves a merchant's affiliate configuration and produces the outbound
 * URL for a click.
 *
 * Credential handling: affiliate_configurations stores only the NAME of the
 * environment variable holding the tracking ID. The value is read here,
 * server-side, used to build the URL, and never returned to the caller or
 * logged. A final leak check catches the case where a secret was
 * mistakenly pasted into a template.
 */

interface ConfigRow {
  merchant_id: string;
  network: string;
  link_strategy: LinkStrategy;
  is_active: boolean;
  base_url_template: string | null;
  tracking_param: string | null;
  tracking_id_env_var: string | null;
  sub_id_param: string | null;
  campaign_param: string | null;
  max_sub_id_length: number | null;
  allowed_deep_link_domains: string[] | null;
  requires_encoded_destination: boolean | null;
}

export interface ResolvedLink extends BuiltLink {
  merchantId: string;
  network: string | null;
}

/**
 * Environment variables that must never appear in an outbound URL. Used
 * only for the leak check — values are never stored or transmitted.
 */
function sensitiveValues(): string[] {
  const names = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "INTERNAL_CRON_SECRET",
    "RESEND_API_KEY",
    "FLIPKART_AFFILIATE_TOKEN",
    "ADMITAD_CLIENT_SECRET",
    "AMAZON_CREATORS_CLIENT_SECRET",
  ];
  // typeof narrows properly; Boolean(v) does not, so v stayed
  // `string | undefined` and v.length was a type error.
  return names
    .map((n) => process.env[n])
    .filter((v): v is string => typeof v === "string" && v.length >= 8);
}

export async function resolveAffiliateLink(
  supabase: SupabaseClient,
  params: {
    merchantId: string;
    destinationUrl: string;
    context?: LinkContext;
  },
): Promise<ResolvedLink> {
  const { data, error } = await supabase
    .from("affiliate_configurations")
    .select(
      `merchant_id, network, link_strategy, is_active, base_url_template, tracking_param,
       tracking_id_env_var, sub_id_param, campaign_param, max_sub_id_length,
       allowed_deep_link_domains, requires_encoded_destination`,
    )
    .eq("merchant_id", params.merchantId)
    .eq("is_active", true)
    .limit(1)
    .returns<ConfigRow[]>();

  // A config lookup failure must not break the purchase — fall back to the
  // merchant's own URL rather than erroring the redirect.
  if (error) {
    return {
      url: params.destinationUrl,
      outcome: "fallback_untracked",
      strategy: null,
      reason: "config_lookup_failed",
      merchantId: params.merchantId,
      network: null,
    };
  }

  const row = data?.[0];

  const config: AffiliateConfig | null = row
    ? {
        merchantId: row.merchant_id,
        network: row.network,
        strategy: row.link_strategy,
        isActive: row.is_active,
        baseUrlTemplate: row.base_url_template,
        trackingParam: row.tracking_param,
        // Resolved from the environment — never from the database.
        trackingId: row.tracking_id_env_var ? (process.env[row.tracking_id_env_var] ?? null) : null,
        subIdParam: row.sub_id_param,
        campaignParam: row.campaign_param,
        maxSubIdLength: row.max_sub_id_length,
        allowedDeepLinkDomains: row.allowed_deep_link_domains,
        requiresEncodedDestination: row.requires_encoded_destination,
      }
    : null;

  const built = buildAffiliateLink(params.destinationUrl, config, params.context ?? {});

  // Last line of defence: if a secret somehow ended up in the outbound URL
  // (e.g. an API token pasted into base_url_template), refuse to use it.
  if (built.url && containsCredentialLeak(built.url, sensitiveValues())) {
    return {
      url: params.destinationUrl,
      outcome: "fallback_untracked",
      strategy: built.strategy,
      reason: "credential_detected_in_url",
      merchantId: params.merchantId,
      network: row?.network ?? null,
    };
  }

  return { ...built, merchantId: params.merchantId, network: row?.network ?? null };
}
