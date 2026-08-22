/**
 * Price alert triggering tests.
 * The duplicate-prevention cases are the ones that matter operationally:
 * a bug there means emailing a user the same drop every two hours.
 */
import {
  decideTrigger, describeDrop, buildNotificationCopy, TRIGGER_COOLDOWN_HOURS,
  type AlertCandidate,
} from "../lib/alerts/rules.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const NOW = new Date("2026-08-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function candidate(over: Partial<AlertCandidate> = {}): AlertCandidate {
  return {
    alertId: "a1", userId: "u1", productId: "p1",
    productTitle: "Test Phone", productSlug: "test-phone",
    targetPrice: 55000, currentPrice: 54000, merchantName: "Store A",
    lastTriggeredAt: null, lastTriggeredPrice: null,
    notifyEmail: true, notifyPriceDrop: true,
    ...over,
  };
}

console.log("The worked example: ₹60,000 → target ₹55,000 → hits ₹55,000");
{
  // Above target: no alert.
  const d = decideTrigger(candidate({ currentPrice: 60000 }), NOW);
  check("₹60,000 vs target ₹55,000 does not fire", !d.shouldTrigger && d.reason === "above_target", d);
}
{
  // Exactly at target: must fire ("₹55,000 or below").
  const d = decideTrigger(candidate({ currentPrice: 55000 }), NOW);
  check("exactly at target fires", d.shouldTrigger, d);
}
{
  const d = decideTrigger(candidate({ currentPrice: 54999 }), NOW);
  check("below target fires", d.shouldTrigger);
  check("creates in-app notification", d.createNotification);
  check("sends email when opted in", d.sendEmail);
}
{
  const d = decideTrigger(candidate({ currentPrice: 55001 }), NOW);
  check("one rupee above target does not fire", !d.shouldTrigger, d);
}

console.log("Duplicate prevention");
{
  // Same price as last notification: already reported.
  const d = decideTrigger(candidate({
    currentPrice: 54000, lastTriggeredAt: hoursAgo(48), lastTriggeredPrice: 54000,
  }), NOW);
  check("same price does not re-notify", !d.shouldTrigger && d.reason === "already_notified_at_this_price", d);
}
{
  // Price went back UP but still under target: not a new drop.
  const d = decideTrigger(candidate({
    currentPrice: 54500, lastTriggeredAt: hoursAgo(48), lastTriggeredPrice: 54000,
  }), NOW);
  check("higher-than-last price does not re-notify", !d.shouldTrigger, d);
}
{
  // Genuine further drop after cooldown: notify again.
  const d = decideTrigger(candidate({
    currentPrice: 52000, lastTriggeredAt: hoursAgo(48), lastTriggeredPrice: 54000,
  }), NOW);
  check("further drop after cooldown re-notifies", d.shouldTrigger, d);
}
{
  // Further drop but inside cooldown: hold off.
  const d = decideTrigger(candidate({
    currentPrice: 52000, lastTriggeredAt: hoursAgo(2), lastTriggeredPrice: 54000,
  }), NOW);
  check("further drop inside cooldown is suppressed", !d.shouldTrigger && d.reason === "within_cooldown", d);
}
{
  const d = decideTrigger(candidate({
    currentPrice: 52000,
    lastTriggeredAt: hoursAgo(TRIGGER_COOLDOWN_HOURS + 1),
    lastTriggeredPrice: 54000,
  }), NOW);
  check("just past cooldown re-notifies", d.shouldTrigger, d);
}
{
  // Legacy row: triggered before, but no recorded price. Cooldown alone
  // must still apply rather than the rule falling through to "notify".
  const d = decideTrigger(candidate({
    currentPrice: 52000, lastTriggeredAt: hoursAgo(1), lastTriggeredPrice: null,
  }), NOW);
  check("null last price still respects cooldown", !d.shouldTrigger && d.reason === "within_cooldown", d);
}
{
  const d = decideTrigger(candidate({
    currentPrice: 52000, lastTriggeredAt: hoursAgo(100), lastTriggeredPrice: null,
  }), NOW);
  check("null last price fires once cooldown passed", d.shouldTrigger, d);
}

console.log("Notification preferences");
{
  const d = decideTrigger(candidate({ notifyPriceDrop: false }), NOW);
  check("price-drop opt-out suppresses entirely", !d.shouldTrigger && d.reason === "notifications_disabled", d);
}
{
  const d = decideTrigger(candidate({ notifyEmail: false }), NOW);
  check("email opt-out still records in-app", d.shouldTrigger && d.createNotification, d);
  check("email opt-out suppresses the email", !d.sendEmail, d);
}

console.log("Edge cases");
{
  // A malformed timestamp must not become an accidental notification storm.
  const d = decideTrigger(candidate({
    currentPrice: 52000, lastTriggeredAt: "not-a-date", lastTriggeredPrice: 54000,
  }), NOW);
  check("garbage timestamp handled without throwing", typeof d.shouldTrigger === "boolean", d);
}
{
  const d = decideTrigger(candidate({ currentPrice: 0.5, targetPrice: 1 }), NOW);
  check("sub-rupee prices handled", d.shouldTrigger);
}
{
  const drop = describeDrop(candidate({ currentPrice: 50000, targetPrice: 55000 }));
  check("drop amount vs target", drop.amount === 5000, drop);
  check("drop percent", Math.abs(drop.percent - 9.0909) < 0.01, drop.percent);
}
{
  const drop = describeDrop(candidate({ currentPrice: 55000, targetPrice: 55000 }));
  check("no negative savings at exactly target", drop.amount === 0, drop);
}
{
  const copy = buildNotificationCopy(candidate({ currentPrice: 54000, targetPrice: 55000 }));
  check("copy names the product", copy.title.includes("Test Phone"), copy.title);
  check("copy states the current price", copy.body.includes("54,000"), copy.body);
  check("copy states the target", copy.body.includes("55,000"), copy.body);
  check("copy names the merchant", copy.body.includes("Store A"), copy.body);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
