/**
 * Notification delivery + unsubscribe tests.
 *
 * The token forgery cases and the hard-bounce case matter most: a forgeable
 * unsubscribe link lets anyone silence anyone, and retrying a hard bounce
 * damages sender reputation for every user.
 */
import {
  createUnsubscribeToken, verifyUnsubscribeToken, peekTokenUserId,
  generateUnsubscribeSalt, buildUnsubscribeUrl,
} from "../lib/notifications/unsubscribe.ts";
import {
  classifyDeliveryResult, isPermanentFailure, isDueForRetry, backoffMinutes,
  channelsFor, MAX_DELIVERY_ATTEMPTS, type DeliveryRecord,
} from "../lib/notifications/delivery.ts";
import { renderPriceAlertEmail, escapeHtml } from "../lib/notifications/templates.ts";
import { isAllowedPushEndpoint, pushSubscriptionSchema } from "../lib/notifications/push.ts";

process.env.NOTIFICATION_TOKEN_SECRET = "test-secret-value-long-enough-for-hmac";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const SALT = "aaaaaaaa-1111-2222-3333-444444444444";

console.log("Unsubscribe tokens");
{
  const token = createUnsubscribeToken({ userId: USER, channel: "price_drop", salt: SALT });
  const verified = verifyUnsubscribeToken(token, SALT);
  check("round-trips", verified?.userId === USER && verified.channel === "price_drop", verified);
}
{
  const token = createUnsubscribeToken({ userId: USER, channel: "all", salt: SALT });
  check("wrong salt rejected (revocation works)", verifyUnsubscribeToken(token, "different-salt") === null);
}
{
  // The forgery case: swapping the user id must invalidate the signature.
  const token = createUnsubscribeToken({ userId: USER, channel: "all", salt: SALT });
  const forged = token.replace(USER, OTHER);
  check("cannot unsubscribe another user by editing the id", verifyUnsubscribeToken(forged, SALT) === null);
}
{
  // Channel escalation: turning a price_drop link into an "all" opt-out.
  const token = createUnsubscribeToken({ userId: USER, channel: "price_drop", salt: SALT });
  const escalated = token.replace("price_drop", "all");
  check("cannot escalate channel", verifyUnsubscribeToken(escalated, SALT) === null);
}
{
  const token = createUnsubscribeToken({ userId: USER, channel: "all", salt: SALT });
  check("tampered signature rejected", verifyUnsubscribeToken(token.slice(0, -3) + "xyz", SALT) === null);
}
check("garbage rejected", verifyUnsubscribeToken("nonsense", SALT) === null);
check("empty rejected", verifyUnsubscribeToken("", SALT) === null);
check("wrong part count rejected", verifyUnsubscribeToken("v1.a.b", SALT) === null);
check("unknown channel rejected", verifyUnsubscribeToken(`v1.${USER}.hacking.sig`, SALT) === null);
check("wrong version rejected", verifyUnsubscribeToken(`v9.${USER}.all.sig`, SALT) === null);
{
  const a = createUnsubscribeToken({ userId: USER, channel: "price_drop", salt: SALT });
  const b = createUnsubscribeToken({ userId: USER, channel: "back_in_stock", salt: SALT });
  check("channels produce different tokens", a !== b);
}
{
  const token = createUnsubscribeToken({ userId: USER, channel: "all", salt: SALT });
  check("peek extracts user id", peekTokenUserId(token) === USER);
  check("peek rejects non-uuid", peekTokenUserId("v1.notauuid.all.sig") === null);
}
{
  const s1 = generateUnsubscribeSalt();
  const s2 = generateUnsubscribeSalt();
  check("salts are unique", s1 !== s2 && s1.length > 20);
}
{
  const token = createUnsubscribeToken({ userId: USER, channel: "all", salt: SALT });
  const url = buildUnsubscribeUrl("https://site.com/", token);
  check("url built without double slash", url.startsWith("https://site.com/unsubscribe?token="), url);
  check("token is url-encoded", !url.slice(url.indexOf("=") + 1).includes(" "));
}

console.log("Permanent vs retryable failures");
check("hard bounce is permanent", isPermanentFailure("hard_bounce"));
check("invalid recipient is permanent", isPermanentFailure("invalid_recipient"));
check("expired push subscription is permanent", isPermanentFailure("push_subscription_expired"));
check("410 Gone is permanent", isPermanentFailure(null, 410));
check("401 is permanent", isPermanentFailure(null, 401));
// 429 must be retryable even though it is 4xx.
check("429 rate limit is RETRYABLE", !isPermanentFailure(null, 429));
check("500 is retryable", !isPermanentFailure(null, 500));
check("503 is retryable", !isPermanentFailure(null, 503));
check("network error is retryable", !isPermanentFailure("network_timeout"));
check("unknown is retryable", !isPermanentFailure(null));

console.log("Delivery classification");
{
  const r = classifyDeliveryResult({ ok: true, attempts: 1 });
  check("success -> sent", r.status === "sent" && r.nextAttemptAt === null);
}
{
  const r = classifyDeliveryResult({ ok: false, attempts: 1, errorCode: "hard_bounce" });
  check("hard bounce -> permanently_failed", r.status === "permanently_failed");
  check("hard bounce never rescheduled", r.nextAttemptAt === null, r);
}
{
  const now = new Date("2026-08-20T12:00:00Z");
  const r = classifyDeliveryResult({ ok: false, attempts: 1, httpStatus: 503, now });
  check("5xx -> failed with retry scheduled", r.status === "failed" && r.nextAttemptAt !== null, r);
  check("retry is in the future", new Date(r.nextAttemptAt!).getTime() > now.getTime());
}
{
  const r = classifyDeliveryResult({ ok: false, attempts: MAX_DELIVERY_ATTEMPTS, httpStatus: 503 });
  check("gives up after max attempts", r.status === "permanently_failed", r);
  check("reason records why", r.reason?.includes("giving_up") === true, r.reason);
}
{
  const r = classifyDeliveryResult({ ok: false, attempts: 1, httpStatus: 429 });
  check("429 retried, not abandoned", r.status === "failed");
}

console.log("Backoff");
{
  const delays = [1, 2, 3, 4].map((a) => backoffMinutes(a));
  check("backoff increases", delays[0] < delays[1] && delays[1] < delays[2], delays);
  check("backoff capped", backoffMinutes(20) <= 600, backoffMinutes(20));
  const twoRuns = new Set([backoffMinutes(3), backoffMinutes(3), backoffMinutes(3), backoffMinutes(3)]);
  // Jitter prevents a thundering herd of simultaneous retries.
  check("backoff is jittered", twoRuns.size > 1, [...twoRuns]);
}

console.log("Retry eligibility");
function rec(over: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    id: "d1", channel: "email", status: "failed", attempts: 1,
    lastAttemptAt: null, nextAttemptAt: null, errorCode: null, ...over,
  };
}
const NOW = new Date("2026-08-20T12:00:00Z");
check("failed with no schedule is due", isDueForRetry(rec(), NOW));
check("failed with past schedule is due",
  isDueForRetry(rec({ nextAttemptAt: "2026-08-20T11:00:00Z" }), NOW));
check("failed with future schedule is NOT due",
  !isDueForRetry(rec({ nextAttemptAt: "2026-08-20T13:00:00Z" }), NOW));
check("sent is never retried", !isDueForRetry(rec({ status: "sent" }), NOW));
check("permanently_failed is never retried", !isDueForRetry(rec({ status: "permanently_failed" }), NOW));
check("suppressed is never retried", !isDueForRetry(rec({ status: "suppressed" }), NOW));
check("exhausted attempts not retried", !isDueForRetry(rec({ attempts: MAX_DELIVERY_ATTEMPTS }), NOW));
check("malformed schedule doesn't strand delivery",
  isDueForRetry(rec({ nextAttemptAt: "not-a-date" }), NOW));

console.log("Channel selection");
check("in_app always included",
  channelsFor({ notifyEmail: false, notifyPush: false, hasPushSubscription: false }).includes("in_app"));
check("email off means no email channel",
  !channelsFor({ notifyEmail: false, notifyPush: false, hasPushSubscription: false }).includes("email"));
check("email on adds email",
  channelsFor({ notifyEmail: true, notifyPush: false, hasPushSubscription: false }).includes("email"));
check("push requires a subscription",
  !channelsFor({ notifyEmail: false, notifyPush: true, hasPushSubscription: false }).includes("push"));
check("push with subscription included",
  channelsFor({ notifyEmail: false, notifyPush: true, hasPushSubscription: true }).includes("push"));

console.log("Email template escaping (feed data is not trusted markup)");
{
  const rendered = renderPriceAlertEmail({
    productTitle: '<script>alert(1)</script> Phone & "Co"',
    productUrl: "https://site.com/p/x",
    currentPrice: "Rs 999",
    targetPrice: "Rs 1000",
    merchantName: "<b>Store</b>",
    unsubscribeUrl: "https://site.com/unsubscribe?token=abc",
    manageAlertsUrl: "https://site.com/alerts",
  });
  check("script tag escaped in html", !rendered.html.includes("<script>"), rendered.html.slice(0, 0));
  check("escaped entity present", rendered.html.includes("&lt;script&gt;"));
  check("ampersand escaped", rendered.html.includes("&amp;"));
  check("merchant markup escaped", !rendered.html.includes("<b>Store</b>"));
  check("plain text alternative present", rendered.text.length > 0 && rendered.text.includes("Price alert"));
  check("unsubscribe link in html", rendered.html.includes("unsubscribe?token=abc"));
  check("unsubscribe link in text", rendered.text.includes("Unsubscribe:"));
  check("subject uses raw title (headers are not html)", rendered.subject.includes("Phone"));
}
check("escapeHtml handles quotes", escapeHtml(`a"b'c`) === "a&quot;b&#39;c");
check("escapeHtml is idempotent-safe on plain text", escapeHtml("normal text") === "normal text");

console.log("Push endpoint validation (SSRF protection)");
check("FCM allowed", isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"));
check("Mozilla allowed", isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"));
check("Apple allowed", isAllowedPushEndpoint("https://web.push.apple.com/x"));
check("Windows wildcard host allowed", isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x"));
// The endpoint becomes a URL our server calls — an arbitrary host would be
// a server-side request forgery primitive.
check("arbitrary host BLOCKED", !isAllowedPushEndpoint("https://evil.example.com/collect"));
check("internal address BLOCKED", !isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data"));
check("localhost BLOCKED", !isAllowedPushEndpoint("https://localhost/x"));
check("http BLOCKED", !isAllowedPushEndpoint("http://fcm.googleapis.com/x"));
check("lookalike suffix BLOCKED", !isAllowedPushEndpoint("https://notfcm.googleapis.com.evil.com/x"));
check("garbage BLOCKED", !isAllowedPushEndpoint("not a url"));

console.log("Push subscription schema");
check("valid subscription accepted", pushSubscriptionSchema.safeParse({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "a".repeat(40), auth: "b".repeat(20) },
}).success);
check("http endpoint rejected", !pushSubscriptionSchema.safeParse({
  endpoint: "http://fcm.googleapis.com/x",
  keys: { p256dh: "a".repeat(40), auth: "b".repeat(20) },
}).success);
check("short key rejected", !pushSubscriptionSchema.safeParse({
  endpoint: "https://fcm.googleapis.com/x",
  keys: { p256dh: "short", auth: "b".repeat(20) },
}).success);
check("missing keys rejected", !pushSubscriptionSchema.safeParse({
  endpoint: "https://fcm.googleapis.com/x",
}).success);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
