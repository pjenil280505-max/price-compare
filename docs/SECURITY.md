# Security Model & Audit Findings

Companion to `supabase/migrations/0008_row_level_security.sql` (the
authoritative policy set) and `.env.local.example` (the secrets inventory).
This documents *why* things are arranged the way they are, and — more
usefully — what is still open.

---

## 1. Secrets

**Rule:** only `NEXT_PUBLIC_*` variables ever reach the browser. Next.js
enforces this at build time by refusing to inline anything else into client
bundles.

| Variable | Exposure | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Fine — RLS is what protects the data, not URL secrecy |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Designed to be public despite the name; can only do what RLS allows |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypasses RLS entirely — treat as a DB root password |
| `ANTHROPIC_API_KEY` | **Server only** | Billable |
| `INTERNAL_CRON_SECRET` | **Server only** | Shared secret for scheduled/ingestion endpoints |
| Affiliate network credentials | **Server only** | Never referenced by this web app; consumed by connectors |

**Enforcement beyond convention:** `lib/supabase/admin.ts` and
`lib/server/auth.ts` both `import "server-only"`, which turns an accidental
client-side import into a *build failure* rather than a silent leak. There's
also a runtime `typeof window !== "undefined"` throw in `createAdminClient()`
as a second layer.

**Verified during audit:** the only three importers of
`lib/supabase/admin.ts` are Route Handlers (`/go/[offerId]`,
`/api/admin/overview`, `/api/admin/matches/[reviewId]`). No file containing
`"use client"` references any server-only variable.

**Note on `affiliate_configurations`:** this table deliberately holds *no*
credentials — only an `env_var_prefix` naming which env vars a connector
should read. Adding an `api_key` column there would make every admin with
dashboard read access able to exfiltrate merchant credentials.

---

## 2. Authorization: three layers, deliberately

1. **Row Level Security (primary).** Enforced by Postgres, so an
   application bug can't bypass it. Every table has RLS enabled.
2. **Route-level checks (`requireUser` / `requireAdmin`).** Fail fast with
   a clear 401/403 instead of RLS quietly returning zero rows.
3. **Middleware.** Redirects unauthenticated users away from `/account`,
   `/wishlist`, `/alerts`; rewrites `/admin` to a 404 for non-admins
   (deliberately a 404, not a 403 — a 403 confirms the route exists).

**Verified during audit:** every route touching user-scoped or admin data
calls `requireUser` or `requireAdmin`. The routes with no auth check are all
public catalog reads (`search`, `products`, `categories`, `merchants`,
`deals`, `trending`, `compare`, `assistant`) — intentional.

### The "no manual product entry" constraint is structural

The platform's core requirement is that product/price data may never be
hand-authored. This is enforced in the schema, not just by convention:
**no role — including admin — has an RLS write policy on `products`,
`product_variants`, `merchant_offers`, or `prices`.** All catalog writes
require the service-role client.

The one admin write path (`/api/admin/matches/[reviewId]`) re-points an
already-ingested offer at a candidate product. It cannot create a product or
edit product content.

---

## 3. Specific hardening applied

- **Open redirect.** `/go/[offerId]` redirects to a DB-stored URL. Now
  validated as a well-formed `http:`/`https:` URL first, rejecting
  `javascript:`, `data:`, and malformed values. Feed data is trusted-ish,
  but a bad row shouldn't turn the domain into a phishing relay.
- **UUID path params.** Passing a non-UUID into a `.eq()` on a uuid column
  makes Postgres raise a cast error, surfacing as an opaque 500.
  `assertUuid()` now guards every UUID route param → clean 400.
- **Error responses.** `withErrorHandling` maps known errors to correct
  status codes and logs unexpected ones server-side, returning a generic
  message. Stack traces are never sent to clients.
- **Input validation.** Every request body is Zod-parsed. Length caps on
  free-text fields (assistant messages, search queries) bound abuse.
- **Field-level write restriction.** `/api/notifications/[id]` accepts only
  `isRead`. RLS scopes the row to its owner but can't stop an owner from
  rewriting their own notification's title — restricting accepted fields
  does.
- **Idempotent writes.** Wishlist add upserts; price-alert create does an
  explicit check-then-write matched to the DB's expression unique index.

---

## 4. Open items — not yet solved

Listed honestly rather than buried.

### 4.1 Rate limiting is in-memory (real limitation)
`lib/server/rateLimit.ts` stores counters in process memory. On
serverless/edge each instance has its own counter, so the effective limit is
`limit × instance count`, and it resets on cold start. Applied to
`/api/assistant` (10/min) and `/api/search` (60/min).

**This is a speed bump, not a quota.** The assistant endpoint is
unauthenticated and calls a billable API on every request — the single
biggest cost-abuse surface in the app. **Swap to Upstash Redis before any
public launch.** The function signature is designed so only the storage
lines change.

### 4.2 No CSP or security headers yet
`next.config.mjs` has no `headers()` block. A Content-Security-Policy
restricting script/image sources, plus `X-Frame-Options` /
`Referrer-Policy` / `Strict-Transport-Security`, should be added before
launch. Deferred because CSP needs the real merchant CDN hostnames, which
aren't known until connectors are live.

### 4.3 Admin role permissions — RESOLVED
Implemented in `lib/server/rbac.ts` (Phase 10). All 13 admin routes now call
`requirePermission(...)` with a specific capability; `requireAdmin()` is no
longer used for authorization. Four seeded roles (superadmin / admin /
editor / viewer) carry distinct permission sets, verified by
`tests/rbac.test.ts`, which also asserts that no admin route can be added
without a permission check.

Note: `view_credentials` and `manage_settings` are superadmin-only by
default, so an `admin` cannot enumerate which credential environment
variables exist.

### 4.4 Audit log — RESOLVED
`audit_log` was added in 0015 and is written by `lib/server/audit.ts` on
connector sync/enable/disable/config changes and match approve/reject.
Entries are redacted (tokens, emails, passwords stripped at any depth) and
the table grants clients no INSERT/UPDATE/DELETE policy, so an admin cannot
tamper with their own trail.

Still unlogged: merge/unmerge and affiliate config changes.

### 4.5 DPDP Act compliance not addressed
India's Digital Personal Data Protection Act applies to a service
collecting emails and behavioural data from Indian users. There's no
consent flow, data-export endpoint, or account-deletion endpoint. `on
delete cascade` FKs mean deleting an `auth.users` row cleans up cleanly, but
no user-facing path triggers it. **Factual note, not legal advice** —
worth a real legal review before launch.

### 4.6 Not tested against a live database
Every migration and query here is written carefully but has **never been
executed** — no Supabase instance was available. Expect to fix things on
first `supabase db push`. The highest-risk items are the nested PostgREST
selects in `lib/server/products.ts` (embedded-resource syntax is easy to get
subtly wrong) and the `ivfflat` index in `0004`, which needs `vector`
available on your Supabase plan.
