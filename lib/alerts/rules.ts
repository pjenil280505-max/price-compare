/**
 * PRICE ALERT TRIGGERING RULES
 *
 * The worked example this must satisfy:
 *   current ₹60,000 → target ₹55,000 → a VERIFIED VALID price reaches
 *   ₹55,000 or below → alert fires.
 *
 * Division of responsibility, deliberately:
 *   - "Is this price valid/current?" is answered by the price engine
 *     (public.price_freshness, via get_alert_candidates). Candidates
 *     arriving here have ALREADY been filtered to in-stock, non-expired
 *     offers. This module never re-derives price validity — duplicating
 *     that logic is exactly how an alert ends up firing on a stale price.
 *   - "Should we notify, given we already notified before?" is answered
 *     here, because it is pure state comparison and benefits from tests.
 */

export interface AlertCandidate {
  alertId: string;
  userId: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  targetPrice: number;
  /** Cheapest valid price, already freshness-filtered upstream. */
  currentPrice: number;
  merchantName?: string;
  lastTriggeredAt: string | null;
  lastTriggeredPrice: number | null;
  notifyEmail: boolean;
  notifyPriceDrop: boolean;
  /** Whether the user opted into browser push. Delivery also requires a stored subscription. */
  notifyPush?: boolean;
}

export type SkipReason =
  | "above_target"
  | "already_notified_at_this_price"
  | "within_cooldown"
  | "notifications_disabled";

export interface TriggerDecision {
  shouldTrigger: boolean;
  /** In-app notification is created whenever the alert fires. */
  createNotification: boolean;
  /** Email is additionally gated on the user's preference. */
  sendEmail: boolean;
  reason?: SkipReason;
}

/**
 * Minimum gap between notifications for the same alert. Without this, a
 * sync running every two hours on a volatile price could email someone
 * repeatedly in a single afternoon.
 */
export const TRIGGER_COOLDOWN_HOURS = 12;

export function decideTrigger(candidate: AlertCandidate, now: Date = new Date()): TriggerDecision {
  const skip = (reason: SkipReason): TriggerDecision => ({
    shouldTrigger: false,
    createNotification: false,
    sendEmail: false,
    reason,
  });

  // Defensive: candidates are pre-filtered by SQL, but a rule that silently
  // trusts its input is a rule that fires wrongly when the query changes.
  if (!(candidate.currentPrice <= candidate.targetPrice)) {
    return skip("above_target");
  }

  if (!candidate.notifyPriceDrop) {
    return skip("notifications_disabled");
  }

  if (candidate.lastTriggeredAt) {
    // Re-notify only if the price has fallen FURTHER than last time.
    // Equal-or-higher means it's the same drop we already reported.
    if (candidate.lastTriggeredPrice != null && candidate.currentPrice >= candidate.lastTriggeredPrice) {
      return skip("already_notified_at_this_price");
    }

    const hoursSince = (now.getTime() - new Date(candidate.lastTriggeredAt).getTime()) / 3_600_000;
    if (Number.isFinite(hoursSince) && hoursSince < TRIGGER_COOLDOWN_HOURS) {
      return skip("within_cooldown");
    }
  }

  return {
    shouldTrigger: true,
    createNotification: true,
    // Email delivery respects the separate email preference; the in-app
    // record is created either way so the user never loses the event.
    sendEmail: candidate.notifyEmail,
  };
}

/** Savings versus the target, for the notification copy. */
export function describeDrop(candidate: AlertCandidate): { amount: number; percent: number } {
  const amount = Math.max(0, candidate.targetPrice - candidate.currentPrice);
  const percent =
    candidate.targetPrice > 0 ? (amount / candidate.targetPrice) * 100 : 0;
  return { amount, percent };
}

export function buildNotificationCopy(candidate: AlertCandidate): { title: string; body: string } {
  const price = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  return {
    title: `${candidate.productTitle} hit your target price`,
    body:
      `Now ${price.format(candidate.currentPrice)}` +
      (candidate.merchantName ? ` at ${candidate.merchantName}` : "") +
      ` — your target was ${price.format(candidate.targetPrice)}.`,
  };
}
