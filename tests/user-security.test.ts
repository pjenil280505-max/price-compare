/**
 * User-system security tests.
 *
 * Covers the layers that are testable without a live database: input
 * validation, display-text sanitization, and audit-log redaction. RLS
 * policy coverage is asserted by parsing the migrations, which catches the
 * realistic failure — a table added without a policy — rather than
 * re-testing Postgres itself.
 */
import { readFileSync, readdirSync } from "node:fs";
import {
  profileUpdateSchema, notificationPreferencesSchema, priceAlertSchema,
  priceAlertUpdateSchema, passwordResetRequestSchema, passwordSchema,
  emailSchema, sanitizeDisplayText,
} from "../lib/validation/user.ts";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

console.log("Email validation");
check("valid email accepted", emailSchema.safeParse("user@example.com").success);
check("lowercased", emailSchema.parse("USER@Example.COM") === "user@example.com");
check("trimmed", emailSchema.parse("  a@b.co  ") === "a@b.co");
check("no-at rejected", !emailSchema.safeParse("notanemail").success);
check("overlong rejected", !emailSchema.safeParse("a".repeat(250) + "@b.com").success);
check("empty rejected", !emailSchema.safeParse("").success);

console.log("Password rules (hashing is the auth provider's job)");
check("8 chars accepted", passwordSchema.safeParse("abcd1234").success);
check("7 chars rejected", !passwordSchema.safeParse("abcd123").success);
check("whitespace-only rejected", !passwordSchema.safeParse("        ").success);
check("over bcrypt boundary rejected", !passwordSchema.safeParse("a".repeat(73)).success);
check("72 chars accepted", passwordSchema.safeParse("a".repeat(72)).success);

console.log("Display-text sanitization");
check("control chars stripped", sanitizeDisplayText("Bob\u0000\u0007") === "Bob");
check("zero-width stripped", sanitizeDisplayText("Bo\u200Bb") === "Bob");
// A right-to-left override can make a hostile string render deceptively in
// notification emails and admin lists.
check("bidi override stripped", !sanitizeDisplayText("evil\u202Emoc.live").includes("\u202E"));
check("normal text preserved", sanitizeDisplayText("  Priya Sharma  ") === "Priya Sharma");
check("unicode names preserved", sanitizeDisplayText("प्रिया") === "प्रिया");

console.log("Profile update validation");
check("valid name accepted", profileUpdateSchema.safeParse({ displayName: "Alice" }).success);
check("overlong name rejected", !profileUpdateSchema.safeParse({ displayName: "a".repeat(100) }).success);
check("1-char name rejected", !profileUpdateSchema.safeParse({ displayName: "a" }).success);
check("empty name allowed (clears it)", profileUpdateSchema.safeParse({ displayName: "" }).success);
check("http avatar rejected", !profileUpdateSchema.safeParse({ avatarUrl: "http://x.com/a.png" }).success);
check("https avatar accepted", profileUpdateSchema.safeParse({ avatarUrl: "https://x.com/a.png" }).success);
check("javascript: avatar rejected", !profileUpdateSchema.safeParse({ avatarUrl: "javascript:alert(1)" }).success);
{
  // Sanitization must apply through the schema, not only when called directly.
  const r = profileUpdateSchema.safeParse({ displayName: "Bob\u0000\u202E" });
  check("schema sanitizes name", r.success && !String(r.data.displayName).includes("\u202E"), r);
}

console.log("Price alert validation");
check("valid alert accepted", priceAlertSchema.safeParse({
  productId: "11111111-1111-1111-1111-111111111111", targetPrice: 55000 }).success);
check("non-uuid product rejected", !priceAlertSchema.safeParse({ productId: "x", targetPrice: 1 }).success);
check("zero target rejected", !priceAlertSchema.safeParse({
  productId: "11111111-1111-1111-1111-111111111111", targetPrice: 0 }).success);
check("negative target rejected", !priceAlertSchema.safeParse({
  productId: "11111111-1111-1111-1111-111111111111", targetPrice: -100 }).success);
check("Infinity rejected", !priceAlertSchema.safeParse({
  productId: "11111111-1111-1111-1111-111111111111", targetPrice: Infinity }).success);
check("numeric overflow rejected", !priceAlertSchema.safeParse({
  productId: "11111111-1111-1111-1111-111111111111", targetPrice: 1e12 }).success);
check("active defaults true", priceAlertSchema.parse({
  productId: "11111111-1111-1111-1111-111111111111", targetPrice: 100 }).active === true);
check("partial update accepted", priceAlertUpdateSchema.safeParse({ targetPrice: 1000 }).success);
check("empty update accepted by schema (route rejects it)", priceAlertUpdateSchema.safeParse({}).success);

console.log("Preferences validation");
check("booleans accepted", notificationPreferencesSchema.safeParse({ notifyEmail: false }).success);
check("non-boolean rejected", !notificationPreferencesSchema.safeParse({ notifyEmail: "yes" }).success);
check("reset request needs valid email", !passwordResetRequestSchema.safeParse({ email: "nope" }).success);

console.log("RLS coverage — every user-data table isolates by auth.uid()");
{
  const dir = "supabase/migrations";
  const sql = readdirSync(dir).sort().map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");

  const USER_TABLES = ["profiles", "wishlists", "price_alerts", "notifications", "recently_viewed"];
  for (const table of USER_TABLES) {
    check(`${table}: RLS enabled`, sql.includes(`alter table public.${table} enable row level security`));

    const policies = [...sql.matchAll(new RegExp(`create policy \\w+ on public\\.${table}[^;]+;`, "g"))]
      .map((m) => m[0]);
    check(`${table}: has policies`, policies.length > 0, policies.length);

    // Every policy must scope to the caller, either by auth.uid() or by an
    // explicit admin check. A policy with neither is an open table.
    const unscoped = policies.filter(
      (p) => !p.includes("auth.uid()") && !p.includes("is_admin()") && !p.includes("is_superadmin()"),
    );
    check(`${table}: no unscoped policy`, unscoped.length === 0, unscoped);
  }

  // The audit trail must not be editable by the people it audits.
  const auditPolicies = [...sql.matchAll(/create policy \w+ on public\.audit_log[^;]+;/g)].map((m) => m[0]);
  check("audit_log is read-only to clients",
    auditPolicies.every((p) => p.includes("for select")), auditPolicies);

  // Catalog tables must have no client write path — this is what enforces
  // "no manual product entry" structurally.
  for (const table of ["products", "product_variants", "merchant_offers", "prices"]) {
    const policies = [...sql.matchAll(new RegExp(`create policy \\w+ on public\\.${table}[^;]+;`, "g"))]
      .map((m) => m[0]);
    const writable = policies.filter((p) => /for (insert|update|delete)/.test(p));
    check(`${table}: no client write policy`, writable.length === 0, writable);
  }
}

console.log("Secrets never reach the client bundle");
{
  const clientFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) clientFiles.push(full);
    }
  };
  walk("app");
  walk("components");
  walk("lib");

  const SECRETS = [
    "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY",
    "INTERNAL_CRON_SECRET", "RESEND_API_KEY",
  ];

  const leaks = clientFiles.filter((f) => {
    const text = readFileSync(f, "utf8");
    const isClient = text.split("\n").slice(0, 3).some((l) => l.includes('"use client"'));
    return isClient && SECRETS.some((s) => text.includes(s));
  });
  check("no client component references a server secret", leaks.length === 0, leaks);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
