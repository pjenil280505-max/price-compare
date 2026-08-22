import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { assertInternalRequest } from "@/lib/server/auth";
import { isEmailConfigured } from "@/lib/notifications/email";
import { buildNotificationCopy, decideTrigger, type AlertCandidate } from "@/lib/alerts/rules";
import { channelsFor } from "@/lib/notifications/delivery";

/**
 * Scheduled price-alert evaluation.
 *
 * get_alert_candidates() supplies alerts whose product has a VALID current
 * price at or below target — validity decided by the price engine's
 * price_freshness(), so an alert can never fire on an expired price. This
 * route only applies the notify-or-not rule and records the outcome.
 */
export const POST = withErrorHandling(async (request: Request) => {
  assertInternalRequest(request);

  const admin = createAdminClient();
  const now = new Date();

  const { data, error } = await admin.rpc("get_alert_candidates", { p_limit: 500 });
  if (error) throw error;

  const candidates: AlertCandidate[] = (
    (data ?? []) as {
      alert_id: string;
      user_id: string;
      product_id: string;
      product_title: string;
      product_slug: string;
      target_price: number;
      current_price: number;
      merchant_name: string | null;
      last_triggered_at: string | null;
      last_triggered_price: number | null;
      notify_email: boolean;
      notify_price_drop: boolean;
      notify_push: boolean;
    }[]
  ).map((row) => ({
    alertId: row.alert_id,
    userId: row.user_id,
    productId: row.product_id,
    productTitle: row.product_title,
    productSlug: row.product_slug,
    targetPrice: Number(row.target_price),
    currentPrice: Number(row.current_price),
    merchantName: row.merchant_name ?? undefined,
    lastTriggeredAt: row.last_triggered_at,
    lastTriggeredPrice: row.last_triggered_price != null ? Number(row.last_triggered_price) : null,
    notifyEmail: row.notify_email,
    notifyPriceDrop: row.notify_price_drop,
    notifyPush: row.notify_push,
  }));

  // Batch-load which users have a push subscription. Querying this per
  // candidate inside the loop was an N+1: a run with 500 due alerts issued
  // 500 extra round trips for what is one indexed lookup.
  const candidateUserIds = [...new Set(candidates.map((c) => c.userId))];
  const usersWithPush = new Set<string>();

  if (candidateUserIds.length > 0) {
    const { data: pushRows, error: pushError } = await admin
      .from("push_subscriptions")
      .select("user_id")
      .in("user_id", candidateUserIds);

    if (pushError) {
      // Not fatal: without this we simply don't queue push, which is
      // currently unimplemented anyway.
      console.error("[alert-trigger] push lookup failed:", pushError.message);
    }
    for (const row of pushRows ?? []) usersWithPush.add(row.user_id as string);
  }

  let triggered = 0;
  let skipped = 0;
  let emailsQueued = 0;
  const failures: string[] = [];

  for (const candidate of candidates) {
    const decision = decideTrigger(candidate, now);
    if (!decision.shouldTrigger) {
      skipped += 1;
      continue;
    }

    const copy = buildNotificationCopy(candidate);

    try {
      const { data: notificationId, error: recordError } = await admin.rpc("record_alert_trigger", {
        p_alert_id: candidate.alertId,
        p_price: candidate.currentPrice,
        p_title: copy.title,
        p_body: copy.body,
        p_create_notification: decision.createNotification,
      });
      if (recordError) throw recordError;

      triggered += 1;

      // Queue per-channel delivery attempts. The sender job picks these up
      // — decoupled so a provider outage retries independently instead of
      // failing the whole alert run.
      if (notificationId) {
        const channels = channelsFor({
          notifyEmail: decision.sendEmail,
          notifyPush: candidate.notifyPush ?? false,
          hasPushSubscription: usersWithPush.has(candidate.userId),
        });

        const { error: queueError } = await admin.rpc("queue_notification_delivery", {
          p_notification_id: notificationId,
          p_channels: channels,
        });
        if (queueError) {
          console.error("[alert-trigger] queue failed", candidate.alertId, queueError.message);
        }
        if (channels.includes("email")) emailsQueued += 1;
      }
    } catch (err) {
      // Identify the alert, never the user or their email — a job log is
      // the wrong place for personal data.
      failures.push(candidate.alertId);
      console.error("[alert-trigger]", candidate.alertId, err instanceof Error ? err.message : "unknown");
    }
  }

  return NextResponse.json({
    ranAt: now.toISOString(),
    candidates: candidates.length,
    triggered,
    skipped,
    // Email delivery itself is not implemented — see docs. Counting what
    // WOULD be sent keeps the gap visible rather than silently absent.
    emailsQueued,
    emailDeliveryConfigured: isEmailConfigured(),
    failures: failures.length,
  });
});
