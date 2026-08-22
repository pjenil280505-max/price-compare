import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { assertInternalRequest } from "@/lib/server/auth";
import { isEmailConfigured, sendEmail, buildUnsubscribeLink } from "@/lib/notifications/email";
import { renderPriceAlertEmail } from "@/lib/notifications/templates";
import { classifyDeliveryResult } from "@/lib/notifications/delivery";

/**
 * Notification sender. Drains the delivery queue: first attempts and
 * due retries, applying the retry policy in lib/notifications/delivery.ts.
 *
 * Separate from the alert job on purpose. A provider outage should retry on
 * its own schedule without re-running price evaluation, and a slow provider
 * must not consume the alert job's time budget.
 */

interface PendingRow {
  delivery_id: string;
  notification_id: string;
  user_id: string;
  channel: string;
  attempts: number;
  title: string;
  body: string | null;
  product_slug: string | null;
  unsubscribe_salt: string;
  notify_email: boolean;
  notify_push: boolean;
}

export const POST = withErrorHandling(async (request: Request) => {
  assertInternalRequest(request);

  const admin = createAdminClient();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;

  const { data, error } = await admin.rpc("get_pending_deliveries", { p_limit: 100 });
  if (error) throw error;

  const pending = (data ?? []) as PendingRow[];

  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  let skipped = 0;

  for (const row of pending) {
    // Preference may have changed (including via unsubscribe) between
    // queueing and sending — re-check rather than sending to someone who
    // has since opted out.
    if (row.channel === "email" && !row.notify_email) {
      await admin.rpc("record_delivery_attempt", {
        p_delivery_id: row.delivery_id,
        p_status: "suppressed",
        p_error_code: "user_opted_out",
      });
      suppressed += 1;
      continue;
    }

    if (row.channel === "email") {
      if (!isEmailConfigured()) {
        // Leave the row pending: this is a configuration gap, not a
        // delivery failure, and burning retry attempts on it would
        // permanently fail messages that could still be sent later.
        skipped += 1;
        continue;
      }

      // The address is resolved at send time and never persisted beside the
      // queue. Supabase Auth is the single owner of the email address.
      const { data: authUser } = await admin.auth.admin.getUserById(row.user_id);
      const to = authUser?.user?.email;

      if (!to) {
        await admin.rpc("record_delivery_attempt", {
          p_delivery_id: row.delivery_id,
          p_status: "permanently_failed",
          p_error_code: "no_recipient_address",
        });
        failed += 1;
        continue;
      }

      const productUrl = row.product_slug ? `${baseUrl}/products/${row.product_slug}` : baseUrl;
      const rendered = renderPriceAlertEmail({
        productTitle: row.title,
        productUrl,
        // The notification body already carries the formatted prices; the
        // template does not recompute anything price-related.
        currentPrice: extractPrice(row.body, 0) ?? "the target price",
        targetPrice: extractPrice(row.body, 1) ?? "your target",
        unsubscribeUrl: buildUnsubscribeLink({
          userId: row.user_id,
          channel: "price_drop",
          salt: row.unsubscribe_salt,
          baseUrl,
        }),
        manageAlertsUrl: `${baseUrl}/alerts`,
      });

      const result = await sendEmail({
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        userId: row.user_id,
        unsubscribeChannel: "price_drop",
        unsubscribeSalt: row.unsubscribe_salt,
        baseUrl,
      });

      const outcome = classifyDeliveryResult({
        ok: result.ok,
        attempts: row.attempts + 1,
        errorCode: result.errorCode,
        httpStatus: result.httpStatus,
      });

      await admin.rpc("record_delivery_attempt", {
        p_delivery_id: row.delivery_id,
        p_status: outcome.status,
        p_error_code: outcome.reason ?? null,
        p_next_attempt_at: outcome.nextAttemptAt,
        p_provider_message_id: result.providerMessageId ?? null,
      });

      if (outcome.status === "sent") sent += 1;
      else failed += 1;
      continue;
    }

    if (row.channel === "push") {
      // Web Push requires VAPID keys and a signing implementation — see
      // lib/notifications/push.ts. Marked rather than silently retried
      // forever, so the gap is visible instead of accumulating.
      await admin.rpc("record_delivery_attempt", {
        p_delivery_id: row.delivery_id,
        p_status: "permanently_failed",
        p_error_code: "push_not_implemented",
      });
      skipped += 1;
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    pending: pending.length,
    sent,
    failed,
    suppressed,
    skipped,
    emailConfigured: isEmailConfigured(),
  });
});

/** Pulls the Nth currency figure out of the notification body. */
function extractPrice(body: string | null, index: number): string | null {
  if (!body) return null;
  const matches = body.match(/₹[\d,]+/g);
  return matches?.[index] ?? null;
}
