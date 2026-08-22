/**
 * Affiliate link tests. Two failure modes matter most:
 *   - fabricating/breaking a link (breaks the purchase, breaches terms)
 *   - leaking a credential or PII into an outbound third-party URL
 */
import {
  buildAffiliateLink, isSafeUrl, isDomainAllowed, sanitizeSubId, containsCredentialLeak,
  type AffiliateConfig,
} from "../lib/affiliate/linkBuilder.ts";
import {
  deriveDeviceContext, sanitizeReferrer, generateSessionToken, buildSubId,
} from "../lib/affiliate/tracking.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const DEST = "https://dl.flipkart.com/dl/product/p/itm123?pid=ABC&affid=partner1";
const PLAIN = "https://shop.example.com/product/123";

function config(over: Partial<AffiliateConfig> = {}): AffiliateConfig {
  return {
    merchantId: "m1", network: "test", strategy: "passthrough", isActive: true,
    ...over,
  };
}

console.log("URL safety");
check("https accepted", isSafeUrl("https://x.com/a"));
check("http accepted", isSafeUrl("http://x.com/a"));
check("javascript: rejected", !isSafeUrl("javascript:alert(1)"));
check("data: rejected", !isSafeUrl("data:text/html,<script>"));
check("relative rejected", !isSafeUrl("/product/1"));
check("garbage rejected", !isSafeUrl("not a url"));

console.log("Domain permission");
check("exact domain allowed", isDomainAllowed("https://shop.com/x", ["shop.com"]));
check("subdomain allowed", isDomainAllowed("https://dl.shop.com/x", ["shop.com"]));
check("different domain blocked", !isDomainAllowed("https://evil.com/x", ["shop.com"]));
check("lookalike suffix blocked", !isDomainAllowed("https://notshop.com/x", ["shop.com"]));
check("empty list = unrestricted", isDomainAllowed("https://anything.com/x", []));
check("null list = unrestricted", isDomainAllowed("https://anything.com/x", null));
check("leading dot tolerated", isDomainAllowed("https://dl.shop.com/x", [".shop.com"]));

console.log("Sub-ID sanitization (no PII may reach a third party)");
check("email stripped to safe chars", !sanitizeSubId("user@example.com", 64)?.includes("@"));
check("safe token preserved", sanitizeSubId("sess_ab12-CD", 64) === "sess_ab12-CD");
check("truncated to limit", sanitizeSubId("a".repeat(100), 20)?.length === 20);
check("empty -> undefined", sanitizeSubId("", 64) === undefined);
check("undefined -> undefined", sanitizeSubId(undefined, 64) === undefined);
check("all-unsafe -> undefined", sanitizeSubId("@@@///", 64) === undefined);

console.log("Fallback — never fabricate, never break");
{
  const r = buildAffiliateLink(DEST, null);
  check("no config -> untracked fallback to real URL", r.outcome === "fallback_untracked" && r.url === DEST, r);
  check("no config reason recorded", r.reason === "no_config");
}
{
  const r = buildAffiliateLink(DEST, config({ isActive: false }));
  check("inactive config -> fallback", r.outcome === "fallback_untracked" && r.url === DEST);
}
{
  const r = buildAffiliateLink("javascript:alert(1)", config());
  check("unsafe destination -> empty url, no redirect possible", r.url === "" && r.outcome === "fallback_untracked");
}
{
  const r = buildAffiliateLink(PLAIN, config({ allowedDeepLinkDomains: ["flipkart.com"] }));
  check("destination outside permitted domains -> fallback", r.reason === "domain_not_permitted", r);
  check("fallback still returns a usable merchant URL", r.url === PLAIN);
}

console.log("Strategy: passthrough");
{
  const r = buildAffiliateLink(DEST, config({ strategy: "passthrough", trackingParam: "affid" }));
  check("tagged feed URL passes through as affiliate", r.outcome === "affiliate", r);
  check("URL unchanged when no subid", r.url === DEST, r.url);
}
{
  // A feed that silently stopped tagging must be DETECTED, not assumed fine.
  const r = buildAffiliateLink(PLAIN, config({ strategy: "passthrough", trackingParam: "affid" }));
  check("untagged feed URL detected", r.reason === "feed_url_missing_tracking_param", r);
  check("untagged still redirects to merchant", r.url === PLAIN);
}
{
  const r = buildAffiliateLink(DEST, config({
    strategy: "passthrough", trackingParam: "affid", subIdParam: "subid",
  }), { subId: "sess_abc" });
  check("subid appended when network permits", r.url.includes("subid=sess_abc"), r.url);
}
{
  // No subIdParam configured = network doesn't document one = don't add it.
  const r = buildAffiliateLink(DEST, config({ strategy: "passthrough", trackingParam: "affid" }),
    { subId: "sess_abc" });
  check("no arbitrary params added when network has no subid param", !r.url.includes("sess_abc"), r.url);
}

console.log("Strategy: query_param");
{
  const r = buildAffiliateLink(PLAIN, config({
    strategy: "query_param", trackingParam: "tag", trackingId: "mysite-21",
  }));
  check("tracking param appended", r.url.includes("tag=mysite-21") && r.outcome === "affiliate", r.url);
}
{
  const r = buildAffiliateLink(PLAIN, config({ strategy: "query_param", trackingParam: "tag" }));
  check("missing trackingId -> fallback, not a broken tag", r.reason === "missing_tracking_param_or_id", r);
}
{
  const r = buildAffiliateLink(PLAIN, config({
    strategy: "query_param", trackingParam: "tag", trackingId: "id1",
    subIdParam: "sid", campaignParam: "camp",
  }), { subId: "s1", campaign: "product_page" });
  check("subid + campaign appended", r.url.includes("sid=s1") && r.url.includes("camp=product_page"), r.url);
}
{
  // Existing params on the merchant URL must survive.
  const withParams = "https://shop.example.com/p/1?color=red";
  const r = buildAffiliateLink(withParams, config({
    strategy: "query_param", trackingParam: "tag", trackingId: "id1",
  }));
  check("existing merchant params preserved", r.url.includes("color=red") && r.url.includes("tag=id1"), r.url);
}

console.log("Strategy: deep_link_template");
{
  const r = buildAffiliateLink(PLAIN, config({
    strategy: "deep_link_template",
    baseUrlTemplate: "https://tracker.example/g/{trackingId}/?ulp={destination}",
    trackingId: "camp99",
  }));
  check("template wrapped", r.outcome === "affiliate" && r.url.startsWith("https://tracker.example/g/camp99/"), r.url);
  check("destination percent-encoded", r.url.includes(encodeURIComponent(PLAIN)), r.url);
}
{
  const r = buildAffiliateLink(PLAIN, config({
    strategy: "deep_link_template",
    baseUrlTemplate: "https://tracker.example/g/?ulp={destination}",
    requiresEncodedDestination: false,
  }));
  check("unencoded destination when network requires raw", r.url.includes(PLAIN), r.url);
}
{
  const r = buildAffiliateLink(PLAIN, config({ strategy: "deep_link_template" }));
  check("missing template -> fallback", r.reason === "missing_template", r);
}
{
  const r = buildAffiliateLink(PLAIN, config({
    strategy: "deep_link_template", baseUrlTemplate: "https://tracker.example/g/{trackingId}/",
  }));
  check("template without {destination} -> fallback", r.reason === "template_missing_destination_placeholder", r);
}
{
  // Unresolved placeholder would produce a literally broken link.
  const r = buildAffiliateLink(PLAIN, config({
    strategy: "deep_link_template",
    baseUrlTemplate: "https://tracker.example/{unknownThing}/?ulp={destination}",
    trackingId: "x",
  }));
  check("unresolved placeholder -> fallback", r.reason?.startsWith("unresolved_placeholder") === true, r);
}
{
  const r = buildAffiliateLink(PLAIN, config({
    strategy: "deep_link_template",
    baseUrlTemplate: "https://tracker.example/g/{trackingId}/?ulp={destination}",
  }));
  check("template needs trackingId but none set -> fallback", r.reason === "missing_tracking_id", r);
}
{
  const r = buildAffiliateLink(PLAIN, config({
    strategy: "deep_link_template",
    baseUrlTemplate: "javascript:steal({destination})",
    trackingId: "x",
  }));
  check("template producing unsafe URL -> fallback", r.reason === "template_produced_invalid_url", r);
}

console.log("Credential leak detection");
check("detects secret in URL", containsCredentialLeak("https://x.com/?k=SuperSecret123", ["SuperSecret123"]));
check("case-insensitive", containsCredentialLeak("https://x.com/?k=supersecret123", ["SuperSecret123"]));
check("clean URL passes", !containsCredentialLeak("https://x.com/?k=abc", ["SuperSecret123"]));
check("no secrets configured -> no false positive", !containsCredentialLeak("https://x.com/", []));
check("short values ignored (too generic to match safely)",
  !containsCredentialLeak("https://x.com/?a=id1", ["id1"]));

console.log("Privacy: device derivation discards the User-Agent");
{
  const android = deriveDeviceContext("Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 Mobile Safari/537.36");
  check("android mobile detected", android.deviceType === "mobile" && android.platform === "android", android);
}
{
  const iphone = deriveDeviceContext("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148");
  check("iphone detected", iphone.deviceType === "mobile" && iphone.platform === "ios", iphone);
}
{
  const ipad = deriveDeviceContext("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148");
  check("ipad classified as tablet not mobile", ipad.deviceType === "tablet", ipad);
}
{
  const desktop = deriveDeviceContext("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120");
  check("windows desktop detected", desktop.deviceType === "desktop" && desktop.platform === "windows", desktop);
}
{
  const bot = deriveDeviceContext("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
  check("bot detected", bot.deviceType === "bot", bot);
}
check("null UA -> unknown", deriveDeviceContext(null).deviceType === "unknown");

console.log("Privacy: referrer stripped to path, external referrers dropped");
check("internal referrer -> path only",
  sanitizeReferrer("https://mysite.com/search?q=secret+query", "https://mysite.com") === "/search",
  sanitizeReferrer("https://mysite.com/search?q=secret+query", "https://mysite.com"));
check("external referrer dropped entirely",
  sanitizeReferrer("https://google.com/search?q=private", "https://mysite.com") === null);
check("null referrer -> null", sanitizeReferrer(null, "https://mysite.com") === null);
check("garbage referrer -> null", sanitizeReferrer("not a url", "https://mysite.com") === null);

console.log("Privacy: session tokens are opaque and non-identifying");
{
  const a = generateSessionToken();
  const b = generateSessionToken();
  check("tokens are 24 hex chars", /^[a-f0-9]{24}$/.test(a), a);
  check("tokens differ each call", a !== b);
}
{
  const sub = buildSubId("abc123def456abc123def456", "products");
  check("subid combines token + page context", sub === "abc123def456abc123def456-products", sub);
  check("no session -> no subid", buildSubId(null, "products") === undefined);
  check("subid strips unsafe context chars",
    !buildSubId("tok", "prod/../etc")?.includes("/"), buildSubId("tok", "prod/../etc"));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
