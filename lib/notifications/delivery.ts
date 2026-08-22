/**
 * NOTIFICATION DELIVERY — retry policy.
 *
 * Pure logic, no I/O, so the retry rules are unit-testable. The provider
 * call itself lives in email.ts.
 *
 * The distinction that matters: a HARD bounce (address doesn't exist) must
 * never be retried — retrying it damages sender reputation and will get the
 * whole domain blocked, taking down alerts for every user. A SOFT failure
 * (rate limit, provider 5xx, network) should be retried with backoff.
 */

export type DeliveryChannel = "email" | "push" | "in_app";

export type DeliveryStatus =
  | "pending"
  | "sent"
  /** Retryable failure; will be attempted again. */
  | "failed"
  /** Terminal: retrying would be harmful or pointless. */
  | "permanently_failed"
  /** Recipient has opted out of this channel. */
  | "suppressed";

export interface DeliveryRecord {
  id: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  errorCode: string | null;
}

export const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * Provider responses that must NOT be retried.
 * Bouncing repeatedly at a dead address is the fastest route to a domain
 * reputation problem.
 */
const PERMANENT_ERROR_CODES = new Set([
  "invalid_recipient",
  "hard_bounce",
  "mailbox_not_found",
  "suppressed",
  "unsubscribed",
  "blocked",
  "invalid_from",
  "invalid_api_key",
  "push_subscription_expired",
  "push_subscription_gone",
]);

/** HTTP statuses from a provider that indicate a permanent problem. */
const PERMANENT_HTTP = new Set([400, 401, 403, 404, 410, 422]);

export function isPermanentFailure(errorCode: string | null, httpStatus?: number): boolean {
  if (errorCode && PERMANENT_ERROR_CODES.has(errorCode)) return true;
  // 429 is explicitly retryable despite being 4xx.
  if (httpStatus === 429) return false;
  if (httpStatus != null && PERMANENT_HTTP.has(httpStatus)) return true;
  return false;
}

/**
 * Exponential backoff with jitter, in minutes: ~2, 8, 30, 120, 480.
 * Jitter matters because a scheduled job retries many deliveries at once;
 * without it they all retry in lockstep and re-trigger the same rate limit.
 */
export function backoffMinutes(attempt: number): number {
  const base = Math.min(480, 2 * 4 ** Math.max(0, attempt - 1));
  const jitter = base * 0.25 * Math.random();
  return Math.round(base + jitter);
}

export interface DeliveryOutcome {
  status: DeliveryStatus;
  nextAttemptAt: string | null;
  /** Human-readable, safe to store — never contains the recipient address. */
  reason?: string;
}

export function classifyDeliveryResult(params: {
  ok: boolean;
  attempts: number;
  errorCode?: string | null;
  httpStatus?: number;
  now?: Date;
}): DeliveryOutcome {
  const now = params.now ?? new Date();

  if (params.ok) {
    return { status: "sent", nextAttemptAt: null };
  }

  const errorCode = params.errorCode ?? null;

  if (isPermanentFailure(errorCode, params.httpStatus)) {
    return {
      status: "permanently_failed",
      nextAttemptAt: null,
      reason: errorCode ?? `http_${params.httpStatus ?? "unknown"}`,
    };
  }

  if (params.attempts >= MAX_DELIVERY_ATTEMPTS) {
    return {
      status: "permanently_failed",
      nextAttemptAt: null,
      reason: `giving_up_after_${params.attempts}_attempts`,
    };
  }

  const delayMs = backoffMinutes(params.attempts) * 60_000;
  return {
    status: "failed",
    nextAttemptAt: new Date(now.getTime() + delayMs).toISOString(),
    reason: errorCode ?? `http_${params.httpStatus ?? "unknown"}`,
  };
}

/** Whether a stored delivery is due for another attempt. */
export function isDueForRetry(record: DeliveryRecord, now: Date = new Date()): boolean {
  if (record.status !== "failed") return false;
  if (record.attempts >= MAX_DELIVERY_ATTEMPTS) return false;
  if (!record.nextAttemptAt) return true;
  const due = new Date(record.nextAttemptAt).getTime();
  // A malformed timestamp shouldn't strand a delivery forever.
  if (!Number.isFinite(due)) return true;
  return due <= now.getTime();
}

/**
 * Which channels to attempt, given the user's preferences.
 * in_app is always included: it is the durable record that the alert fired,
 * and switching off email must not erase that history.
 */
export function channelsFor(prefs: {
  notifyEmail: boolean;
  notifyPush: boolean;
  hasPushSubscription: boolean;
}): DeliveryChannel[] {
  const channels: DeliveryChannel[] = ["in_app"];
  if (prefs.notifyEmail) channels.push("email");
  if (prefs.notifyPush && prefs.hasPushSubscription) channels.push("push");
  return channels;
}
