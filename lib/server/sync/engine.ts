import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getConnector } from "@/lib/connectors/registry";
import { queueForReview, resolveMatch } from "@/lib/matching/service";
import {
  FatalConnectorError,
  normalizedProductSchema,
  type ConnectorContext,
  type ConnectorFailure,
  type NormalizedProduct,
  type SyncMode,
} from "@/lib/connectors/types";

/**
 * THE SYNC ENGINE
 *
 * Owns everything that is the same for every merchant: resolving
 * credentials, opening a sync_logs run, enforcing a time budget, validating
 * each product, persisting it, recording per-record failures, checkpointing
 * the cursor, and closing the run out with accurate counts.
 *
 * Connectors own only "how do I talk to this one merchant." That split is
 * what makes merchant #20 a new file rather than a refactor.
 */

export interface RunSyncOptions {
  syncJobId: string;
  mode?: SyncMode;
  /** Wall-clock budget. Serverless platforms cap request duration; a long
   *  catalog sync is expected to span several runs, resuming via cursor. */
  timeBudgetMs?: number;
  /** Set when a human clicked "Sync Now", for the run log. */
  triggeredBy?: string;
}

export interface SyncResult {
  syncLogId: string;
  status: "success" | "error";
  itemsProcessed: number;
  itemsMatched: number;
  itemsFlagged: number;
  errorMessage?: string;
  timedOut: boolean;
}

const DEFAULT_TIME_BUDGET_MS = 4 * 60 * 1000;
const MAX_RAW_PAYLOAD_CHARS = 4000;

export async function runSync(options: RunSyncOptions): Promise<SyncResult> {
  const admin = createAdminClient();
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const startedAt = Date.now();

  // ---- Load job + merchant + affiliate config -------------------------
  const { data: jobRows, error: jobError } = await admin
    .from("sync_jobs")
    .select("id, merchant_id, job_type, connector_key, config, is_active, schedule_interval_minutes")
    .eq("id", options.syncJobId)
    .limit(1);

  if (jobError) throw jobError;
  if (!jobRows || jobRows.length === 0) throw new Error("Sync job not found");

  const job = jobRows[0];
  if (!job.is_active) {
    throw new Error("This connector is disabled. Enable it before running a sync.");
  }

  const connector = getConnector(job.connector_key);
  if (!connector) {
    throw new Error(
      `No connector registered for key "${job.connector_key}". ` +
        `Register it in lib/connectors/registry.ts.`,
    );
  }

  const mode = (options.mode ?? job.job_type) as SyncMode;
  if (!connector.supportedModes.includes(mode)) {
    throw new Error(
      `Connector "${connector.key}" does not support mode "${mode}". ` +
        `Supported: ${connector.supportedModes.join(", ") || "none (placeholder connector)"}.`,
    );
  }

  // ---- Open the run log ----------------------------------------------
  const { data: logRow, error: logError } = await admin
    .from("sync_logs")
    .insert({ sync_job_id: job.id, status: "running" })
    .select("id")
    .single();

  if (logError) throw logError;
  const syncLogId = logRow.id as string;

  const logLines: string[] = [];
  const log = (message: string) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    logLines.push(line);
    if (logLines.length > 500) logLines.shift();
  };

  if (options.triggeredBy) log(`Manually triggered by ${options.triggeredBy}`);
  log(`Starting ${mode} sync via ${connector.displayName}`);

  let itemsProcessed = 0;
  let itemsMatched = 0;
  let itemsFlagged = 0;
  let autoMerged = 0;
  let queuedForReview = 0;
  let timedOut = false;

  const abortController = new AbortController();
  const budgetTimer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeBudgetMs);

  try {
    // ---- Resolve credentials (fail fast, never silently empty) --------
    const credentials = await resolveCredentials(admin, job.merchant_id, connector.requiredCredentials);

    // ---- Load cursor -------------------------------------------------
    const { data: stateRows } = await admin
      .from("connector_state")
      .select("cursor")
      .eq("sync_job_id", job.id)
      .limit(1);

    const ctx: ConnectorContext = {
      config: (job.config ?? {}) as Record<string, unknown>,
      credentials,
      cursor: (stateRows?.[0]?.cursor ?? {}) as Record<string, unknown>,
      log,
      signal: abortController.signal,
    };

    // ---- Drive the connector ----------------------------------------
    for await (const page of connector.sync(mode, ctx)) {
      const validProducts: NormalizedProduct[] = [];
      const pageFailures: ConnectorFailure[] = [...(page.failures ?? [])];

      for (const candidate of page.products) {
        const parsed = normalizedProductSchema.safeParse(candidate);
        if (parsed.success) {
          validProducts.push(parsed.data);
        } else {
          pageFailures.push({
            externalId: (candidate as { externalId?: string })?.externalId,
            stage: "validate",
            reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
            raw: candidate,
          });
        }
      }

      // Bounded concurrency: one RPC per product sequentially means 500
      // round trips per page (~seconds of pure latency). 5 in flight cuts
      // that substantially while staying well clear of connection-pool
      // limits on a small Supabase instance. ingest_matched_product is
      // upsert-based and safe to run concurrently — a race on the same
      // brand/category resolves via ON CONFLICT.
      const INGEST_CONCURRENCY = 5;

      async function persistOne(product: NormalizedProduct): Promise<void> {
        try {
          if (!product.isAvailable) {
            // Delta feeds signal deletion this way — deactivate rather than
            // upsert, so history and click records survive.
            await admin
              .from("merchant_offers")
              .update({ is_active: false })
              .eq("merchant_id", job.merchant_id)
              .eq("external_product_id", product.externalId);
            return;
          }

          // --- MATCHING -------------------------------------------------
          // Decide which existing product (if any) this listing belongs to
          // before writing. auto_merge attaches to the matched product;
          // review creates its own product AND queues an admin decision, so
          // the price is live immediately rather than blocked on a human.
          const match = await resolveMatch(admin, {
            externalId: product.externalId,
            title: product.title,
            brand: product.brand,
            model: product.model,
            mpn: product.mpn,
            gtin: product.gtin,
            variantAttributes: product.variantAttributes,
          });

          const attachToProductId = match.decision === "auto_merge" ? match.productId : null;

          const { data: ingested, error: ingestError } = await admin.rpc("ingest_matched_product", {
            p_merchant_id: job.merchant_id,
            p_external_id: product.externalId,
            p_title: product.title,
            p_product_url: product.productUrl,
            p_price: product.price,
            p_matched_product_id: attachToProductId,
            p_variant_signature: match.fingerprint.variantSignature,
            p_variant_axes: match.fingerprint.axes,
            p_variant_label: product.variantLabel ?? match.fingerprint.variantLabel,
            p_product_key: match.fingerprint.productKey,
            p_match_tier: match.tier,
            p_match_confidence: match.confidence,
            p_currency: product.currency,
            p_mrp: product.mrp ?? null,
            p_in_stock: product.inStock,
            p_cod_available: product.codAvailable ?? false,
            p_brand_name: product.brand ?? null,
            p_category_name: product.category ?? null,
            p_description: product.description ?? null,
            p_image_urls: product.imageUrls,
            p_gtin: match.fingerprint.gtin ?? null,
            p_mpn: product.mpn ?? null,
            p_model: product.model ?? null,
            p_specs: product.specs,
            p_rating: product.rating ?? null,
            p_review_count: product.reviewCount ?? null,
          });

          if (ingestError) throw ingestError;

          if (match.decision === "auto_merge") autoMerged += 1;

          // Queue uncertain matches. Done after ingest so we have the real
          // offer id to attach the review to.
          if (match.decision === "review" && match.productId) {
            const offerId = (ingested as { offer_id?: string }[] | null)?.[0]?.offer_id;
            if (offerId) {
              try {
                await queueForReview(admin, {
                  merchantOfferId: offerId,
                  candidateProductId: match.productId,
                  subjectTitle: product.title,
                  result: match,
                });
                queuedForReview += 1;
              } catch (queueError) {
                // A queueing failure must not fail the ingest — the product
                // is already saved correctly as its own row.
                log(
                  `Could not queue review for ${product.externalId}: ` +
                    (queueError instanceof Error ? queueError.message : "unknown"),
                );
              }
            }
          }

          itemsMatched += 1;
        } catch (error) {
          pageFailures.push({
            externalId: product.externalId,
            stage: "persist",
            reason: error instanceof Error ? error.message : "Unknown persist error",
            raw: product,
          });
        }
      }

      itemsProcessed += validProducts.length;

      for (let i = 0; i < validProducts.length; i += INGEST_CONCURRENCY) {
        if (abortController.signal.aborted) break;
        await Promise.all(validProducts.slice(i, i + INGEST_CONCURRENCY).map(persistOne));
      }

      if (pageFailures.length > 0) {
        itemsFlagged += pageFailures.length;
        await recordFailures(admin, syncLogId, pageFailures);
      }

      // Checkpoint the cursor after each page, so an interrupted run
      // resumes where it left off rather than restarting the catalog.
      if (page.cursor) {
        await admin
          .from("connector_state")
          .upsert({ sync_job_id: job.id, cursor: page.cursor }, { onConflict: "sync_job_id" });
      }

      if (abortController.signal.aborted) {
        log(`Time budget of ${Math.round(timeBudgetMs / 1000)}s reached — will resume next run`);
        break;
      }
    }

    // ---- Full-catalog cleanup ----------------------------------------
    // Only meaningful after a complete full sync: anything we didn't see is
    // delisted. Skipped when the run timed out, because a partial sweep
    // would wrongly deactivate everything we simply didn't reach.
    if (mode === "full_catalog" && !timedOut && itemsMatched > 0) {
      const { data: deactivated } = await admin.rpc("deactivate_missing_offers", {
        p_merchant_id: job.merchant_id,
        p_before: new Date(startedAt).toISOString(),
      });
      if (deactivated) log(`Deactivated ${deactivated} offers no longer in the feed`);
    }

    log(
      `Finished: ${itemsMatched} persisted, ${autoMerged} auto-merged, ` +
        `${queuedForReview} queued for review, ${itemsFlagged} flagged, ${itemsProcessed} seen`,
    );

    await admin
      .from("sync_logs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        items_processed: itemsProcessed,
        items_matched: itemsMatched,
        items_flagged: itemsFlagged,
        error_message: logLines.slice(-40).join("\n"),
      })
      .eq("id", syncLogId);

    await admin
      .from("sync_jobs")
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: nextRunAt(job.schedule_interval_minutes),
        consecutive_failures: 0,
      })
      .eq("id", job.id);

    return { syncLogId, status: "success", itemsProcessed, itemsMatched, itemsFlagged, timedOut };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    log(`FAILED: ${message}`);

    await admin
      .from("sync_logs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        items_processed: itemsProcessed,
        items_matched: itemsMatched,
        items_flagged: itemsFlagged,
        error_message: `${message}\n\n${logLines.slice(-40).join("\n")}`,
      })
      .eq("id", syncLogId);

    // Increment the failure counter so a persistently broken connector
    // backs off instead of hammering the merchant's API every schedule.
    const { data: current } = await admin
      .from("sync_jobs")
      .select("consecutive_failures")
      .eq("id", job.id)
      .limit(1);

    const failures = (current?.[0]?.consecutive_failures ?? 0) + 1;
    await admin
      .from("sync_jobs")
      .update({
        last_run_at: new Date().toISOString(),
        // Exponential backoff on the schedule itself, capped at 24h, so a
        // broken connector stops retrying every few minutes.
        next_run_at: nextRunAt(
          Math.min(24 * 60, job.schedule_interval_minutes * 2 ** Math.min(failures, 5)),
        ),
        consecutive_failures: failures,
      })
      .eq("id", job.id);

    return {
      syncLogId,
      status: "error",
      itemsProcessed,
      itemsMatched,
      itemsFlagged,
      errorMessage: message,
      timedOut,
    };
  } finally {
    clearTimeout(budgetTimer);
  }
}

/**
 * Resolves `${env_var_prefix}_${NAME}` for each credential the connector
 * declares. Throws a clear, actionable error when one is missing — an
 * unauthenticated sync that silently returns zero products is far worse
 * than a loud failure.
 */
async function resolveCredentials(
  admin: SupabaseClient,
  merchantId: string,
  required: readonly string[],
): Promise<Record<string, string>> {
  if (required.length === 0) return {};

  const { data, error } = await admin
    .from("affiliate_configurations")
    .select("env_var_prefix, is_active")
    .eq("merchant_id", merchantId)
    .eq("is_active", true)
    .limit(1);

  if (error) throw error;

  const prefix = data?.[0]?.env_var_prefix;
  if (!prefix) {
    throw new FatalConnectorError(
      "No active affiliate_configurations row with an env_var_prefix for this merchant. " +
        "See docs/CONNECTORS.md for setup.",
    );
  }

  const credentials: Record<string, string> = {};
  const missing: string[] = [];

  for (const name of required) {
    const envName = `${prefix}_${name}`;
    const value = process.env[envName];
    if (!value) missing.push(envName);
    else credentials[name] = value;
  }

  if (missing.length > 0) {
    throw new FatalConnectorError(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Set them in your deployment environment — never in sync_jobs.config, which admins can read.`,
    );
  }

  return credentials;
}

async function recordFailures(
  admin: SupabaseClient,
  syncLogId: string,
  failures: ConnectorFailure[],
): Promise<void> {
  // Cap per page so a systematically-broken feed can't write a million rows.
  const capped = failures.slice(0, 200);

  const rows = capped.map((failure) => ({
    sync_log_id: syncLogId,
    external_product_id: failure.externalId ?? null,
    stage: failure.stage,
    reason: failure.reason.slice(0, 2000),
    raw_payload: truncateRaw(failure.raw),
  }));

  const { error } = await admin.from("sync_failures").insert(rows);
  // A failure-logging failure must not abort the sync itself.
  if (error) console.error("[sync] could not record failures:", error.message);
}

function truncateRaw(raw: unknown): unknown {
  if (raw == null) return null;
  try {
    const json = JSON.stringify(raw);
    if (json.length <= MAX_RAW_PAYLOAD_CHARS) return raw;
    return { truncated: true, preview: json.slice(0, MAX_RAW_PAYLOAD_CHARS) };
  } catch {
    return { unserializable: true };
  }
}

/** ISO timestamp `minutes` from now, for sync_jobs.next_run_at. */
function nextRunAt(minutes: number): string {
  return new Date(Date.now() + Math.max(5, minutes) * 60_000).toISOString();
}
