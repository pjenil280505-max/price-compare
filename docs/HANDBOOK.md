# Platform Handbook

Everything needed to run this platform, written for phone-only operation.

---

## 1. Final architecture

```
                    ┌─────────────────────────────────────────┐
  MERCHANT DATA     │  Flipkart Affiliate API                 │
  (authorized only) │  XML/CSV product feeds (Admitad, CJ…)   │
                    │  Amazon — blocked, see §4               │
                    └──────────────────┬──────────────────────┘
                                       │ scheduled pull
                    ┌──────────────────▼──────────────────────┐
                    │  CONNECTOR LAYER   lib/connectors/      │
                    │  MerchantConnector interface            │
                    │  retries · rate limits · pagination     │
                    │  cursor checkpointing · failure capture │
                    └──────────────────┬──────────────────────┘
                                       │ NormalizedProduct
                    ┌──────────────────▼──────────────────────┐
                    │  MATCHING          lib/matching/        │
                    │  9 tiers: GTIN → MPN → model →          │
                    │  brand+model → variant → title →        │
                    │  fuzzy → AI (review-only)               │
                    │  productKey ≠ variantSignature          │
                    └──────────────────┬──────────────────────┘
                                       │ resolved identity
                    ┌──────────────────▼──────────────────────┐
                    │  ingest_matched_product()               │
                    │  THE ONLY WRITE PATH INTO THE CATALOG   │
                    └──────────────────┬──────────────────────┘
                                       │
   ┌───────────────────────────────────▼─────────────────────────────┐
   │  POSTGRES (Supabase) — RLS on every table                       │
   │  products · product_variants · merchant_offers · prices         │
   │  price_history (+ daily rollup) · alerts · notifications        │
   └───────┬──────────────────┬───────────────────┬──────────────────┘
           │                  │                   │
   ┌───────▼──────┐  ┌────────▼────────┐  ┌───────▼─────────┐
   │ PRICE ENGINE │  │ SEARCH          │  │ AFFILIATE       │
   │ freshness    │  │ NL parsing      │  │ 3 strategies    │
   │ statistics   │  │ typo tolerance  │  │ /go redirect    │
   │ rollup       │  │ variant-aware   │  │ click tracking  │
   └───────┬──────┘  └────────┬────────┘  └───────┬─────────┘
           └──────────────────┼───────────────────┘
                    ┌─────────▼─────────┐
                    │  NEXT.JS 15 APP   │
                    │  RSC + islands    │
                    └───────────────────┘
```

### The three invariants everything else serves

**1. No manual product data.** Enforced structurally: RLS grants *no* client
role write access to `products`, `product_variants`, `merchant_offers` or
`prices`. Not even a superadmin can insert a product through the API. The
only write path is `ingest_matched_product()`, called by the sync engine via
the service role.

**2. Stale prices are never presented as current.** `price_freshness()` is
defined once in SQL and consumed by the product page, search, alerts, deals
and structured data. An expired price is excluded from cheapest-offer
selection, from alert triggering, and from JSON-LD published to search
engines. When every price is expired, the page says so rather than showing
one.

**3. Variants never merge.** Product identity (`product_key`) is computed
with variant tokens *removed*; variant identity (`variant_signature`) is
those tokens. A `UNIQUE (product_id, variant_signature)` index means 256GB
and 512GB physically cannot occupy the same row — regardless of matcher
confidence.

### Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router | RSC keeps catalog pages server-rendered for SEO |
| Database | Supabase Postgres | RLS enforces isolation at the data layer, not the API |
| Search | Postgres FTS + pg_trgm | No separate search service to run or pay for |
| Hosting | Cloudflare Pages or Vercel | See §7 — the free-tier licence differs |
| Scheduling | GitHub Actions | Free, version-controlled, triggerable from Android |
| Email | Resend | Optional; degrades cleanly when absent |

---

## 2. Folder structure

```
frontend/
├── app/
│   ├── (marketing)/          Public, indexable
│   │   ├── page.tsx                     home
│   │   ├── search/ products/[slug]/ compare/
│   │   ├── categories/ deals/ stores/ assistant/
│   │   └── about/ privacy/ terms/ cookies/
│   │       affiliate-disclosure/ price-disclaimer/ contact/
│   ├── (auth)/               login · signup · forgot/reset-password
│   ├── (dashboard)/          account · wishlist · alerts · notifications
│   ├── admin/                17 sections, mobile-first drawer nav
│   ├── api/
│   │   ├── (public)          search · products · categories · deals
│   │   ├── (user)            wishlist · alerts · profile · recently-viewed
│   │   ├── admin/            13 routes, each permission-gated
│   │   ├── internal/         cron-only: sync · alerts · notifications · rollup
│   │   └── unsubscribe/ push/
│   ├── go/[offerId]/         affiliate redirect + click logging
│   ├── sitemap.ts robots.ts layout.tsx
│
├── lib/
│   ├── connectors/           MerchantConnector, registry, flipkart/, generic-feed/
│   ├── matching/             normalize · variant · matcher · service
│   ├── pricing/              engine (freshness, statistics)
│   ├── affiliate/            linkBuilder · resolver · tracking
│   ├── alerts/               rules (trigger + duplicate suppression)
│   ├── notifications/        delivery · email · templates · unsubscribe · push
│   ├── search/               queryParser · types
│   ├── seo/                  structuredData · site
│   ├── server/               auth · rbac · audit · errors · rateLimit · sync/
│   ├── supabase/             client · server · public · admin
│   └── validation/           user input schemas
│
├── components/               ui · layout · product · search · admin · …
├── supabase/migrations/      0001–0019, run in order
├── tests/                    15 suites, 614 assertions
├── e2e/                      Playwright specs (never executed — see §8)
├── scripts/test-all.mjs      the test runner
├── docs/                     CONNECTORS · SECURITY · DATABASE · TESTING
└── .github/workflows/        test · sync-connectors · price-rollup · notifications
```

---

## 3. Completed features

**Ingestion** — connector interface, Flipkart connector (built against their
published v1.1.0 schema), generic XML/CSV feed connector, sync engine with
retries/backoff/rate limiting/cursor checkpointing/per-record failure
capture, GitHub Actions scheduling, Sync Now, enable/disable, backoff on
repeated failure.

**Matching** — 9 tiers, GTIN check-digit validation, brand gating, variant
extraction (storage/RAM/size/colour/capacity/screen/count), hard-conflict
blocking, confidence scoring, admin review queue, merge/unmerge with
snapshot-based reversal and audit logging.

**Pricing** — per-merchant freshness TTL, three-state classification, price
history with daily rollup, lowest/highest/average with a data-sufficiency
gate, price-drop detection, cheapest-merchant selection excluding expired
and out-of-stock.

**Search** — natural-language parsing (₹/k/lakh/crore, under/over/between,
spec filters, sort intent), typo tolerance via trigram fallback,
variant-correct pricing, 6 sort modes, stable pagination.

**Affiliate** — 3 configuration-driven link strategies, `/go` redirect with
open-redirect protection, fallback that never breaks a purchase, 8 diagnosed
failure reasons, privacy-conscious click tracking, analytics.

**Users** — Supabase Auth, enumeration-resistant password reset, profile,
wishlist, recently viewed (auto-pruned), price alerts with target editing,
notification preferences, RFC 8058 one-click unsubscribe, in-app
notification history.

**Alerts** — scheduled evaluation on freshness-verified prices only,
duplicate suppression (price must fall *further*), 12h cooldown, per-channel
delivery queue with retry policy distinguishing hard bounces from soft
failures.

**Admin** — 17 sections, RBAC across 4 roles, mobile drawer navigation,
System Health, credentials status (never values), audit log that admins
cannot tamper with.

**Production** — structured data (freshness-gated), sitemap, robots,
canonical URLs, OG/Twitter, security headers, ISR caching, code splitting,
transform-based animations, WCAG-conscious accessibility, 7 legal pages.

---

## 4. Missing credentials & merchant approvals

This is the honest blocker list. **No amount of code substitutes for these.**

### Flipkart Affiliate — apply first
- Sign up at `affiliate.flipkart.com`, get approved
- Generate a **Tracking ID** and **API Token** from the dashboard's API section
- **No sales gate** — this is why it's merchant #1
- Set `FLIPKART_AFFILIATE_ID`, `FLIPKART_AFFILIATE_TOKEN`

> **Known limitation:** Flipkart's feed publishes **no GTIN/EAN/UPC**. Verified
> against their docs. Cross-merchant matching for Flipkart-only items must
> rely on title/brand/attribute similarity, so expect some duplicates until a
> second merchant with barcodes is added.

### Affiliate networks (Admitad, CJ, Awin, vCommission)
- Apply as a publisher; price comparison is an accepted model for most
- On approval you receive a **feed URL** and a **deep-link format**
- Set `<PREFIX>_FEED_URL`; put the field mapping in `sync_jobs.config`
- **No code needed** — the generic connector covers these

### Amazon — blocked, not a code gap
Two independent blockers: PA-API 5.0 is being retired for a new OAuth
Creators API, **and** access requires qualifying referred sales in a
trailing 30-day window. A new site cannot obtain credentials on day one.
`lib/connectors/amazon/connector.ts` documents the implementation steps for
when you're eligible. Worth prioritising then — Amazon *does* publish GTINs.

### Other external services
| Service | Needed for | Blocking? |
|---|---|---|
| Supabase project | Everything | **Yes** |
| Resend + verified domain | Alert emails | No — alerts still record in-app |
| Anthropic API key | AI assistant, AI match tier | No |
| VAPID keys | Web push | No — sending isn't implemented anyway |

---

## 5. Environment variables

```bash
# ─── REQUIRED ────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server-only, never NEXT_PUBLIC_
NEXT_PUBLIC_SITE_URL=https://your-domain.com   # canonical URLs + email links
INTERNAL_CRON_SECRET=<openssl rand -hex 32>    # authenticates scheduled jobs

# ─── MERCHANTS (per approved merchant) ───────────────────────────────
FLIPKART_AFFILIATE_ID=
FLIPKART_AFFILIATE_TOKEN=
# <PREFIX>_FEED_URL=                            # generic feed connectors

# ─── NOTIFICATIONS (optional) ────────────────────────────────────────
RESEND_API_KEY=
NOTIFICATION_FROM_EMAIL=alerts@your-domain.com
NOTIFICATION_TOKEN_SECRET=<openssl rand -hex 32>   # signs unsubscribe links

# ─── OPTIONAL ────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=
NEXT_PUBLIC_CONTACT_EMAIL=hello@your-domain.com
VAPID_PUBLIC_KEY= VAPID_PRIVATE_KEY= VAPID_SUBJECT=
```

**Rules that matter:**
- Only `NEXT_PUBLIC_*` reaches the browser. Everything else is server-only,
  and `tests/user-security.test.ts` asserts no client component references a
  secret.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely. It appears in exactly
  four places, all server-only.
- Credential *values* are never stored in the database. `affiliate_configurations`
  holds only the variable **name**.
- `NOTIFICATION_TOKEN_SECRET` falls back to the service-role key if unset —
  workable, but then rotating it to revoke unsubscribe links would take the
  whole app down. Set a dedicated one.

---

## 6. Database setup

From Android: use the **Supabase dashboard SQL editor** — no CLI needed.

1. Create a project at `supabase.com` (free tier is fine to start).
2. Open **SQL Editor**. Paste and run each migration **in numeric order**,
   `0001` through `0019`, one at a time. Order matters: later migrations
   drop and supersede earlier functions.
3. Enable **Email** auth under Authentication → Providers. Set the Site URL
   and add `<site>/auth/callback` to redirect URLs.
4. Create your account through the app's signup page.
5. Grant yourself superadmin:

```sql
insert into public.admin_users (user_id, role_id)
values (
  (select id from auth.users where email = 'you@example.com'),
  (select id from public.roles where name = 'superadmin')
);
```

6. Add your first merchant:

```sql
-- 1. the merchant
insert into public.merchants (name, slug, price_ttl_hours, is_active)
values ('Flipkart', 'flipkart', 12, true);

-- 2. affiliate config — env var NAMES only, never values
insert into public.affiliate_configurations (
  merchant_id, network, link_strategy, tracking_param,
  env_var_prefix, tracking_id_env_var, allowed_deep_link_domains, is_active
) values (
  (select id from public.merchants where slug = 'flipkart'),
  'flipkart_affiliate', 'passthrough', 'affid',
  'FLIPKART', 'FLIPKART_AFFILIATE_ID', array['flipkart.com'], true
);

-- 3. sync job — start with ONE category so the first run is verifiable
insert into public.sync_jobs (
  merchant_id, job_type, connector_key, schedule_interval_minutes, config, is_active
) values (
  (select id from public.merchants where slug = 'flipkart'),
  'full_catalog', 'flipkart_affiliate', 360,
  '{"categories": ["mobiles"], "inStockOnly": true, "maxPagesPerCategory": 5}'::jsonb,
  true
);
```

7. Add a monthly partition job for `price_history` (see `docs/DATABASE.md`).

**Free-tier note:** Supabase pauses a project after 7 days of inactivity.
The sync workflow's regular requests prevent this.

---

## 7. Deployment

### Hosting choice — read before picking

**Vercel's Hobby tier is non-commercial.** A site earning affiliate
commission is commercial use. Either use **Cloudflare Pages** (free tier
permits commercial use) or **Vercel Pro** (~$20/mo).

### Cloudflare Pages
1. Connect the GitHub repo
2. Framework preset: **Next.js**
3. Add every variable from §5 under Settings → Environment variables
4. Deploy

### Vercel Pro
1. Import the repo; Next.js is auto-detected
2. Add environment variables for Production **and** Preview
3. Deploy

### After first deploy
- Add merchant CDN hostnames to `next.config.mjs` → `images.remotePatterns`,
  or **product images will not render**. You'll see the hostnames in the
  first sync's data.
- Add repo secrets for the scheduled workflows: `APP_BASE_URL`,
  `INTERNAL_CRON_SECRET`.
- Consider enabling CSP — `next.config.mjs` has a draft policy and explains
  why it's deferred until merchant hostnames are known.

---

## 8. Testing

```bash
npm test                   # 15 suites, 614 assertions, ~3 seconds
npm test seo a11y          # only matching suites
npm run typecheck:server   # type-check the server layer
npm run test:e2e           # Playwright — needs a running app
```

`npm test` requires **no `npm install`** — it runs against offline stubs, so
it works on a fresh checkout and in CI without a registry. From Android:
push a commit and read the result in the GitHub app.

### What is genuinely executed

| Layer | Executed | How |
|---|---|---|
| Pure logic (pricing, matching, search, alerts, affiliate, notifications, SEO) | **Yes** | Real modules run via Node type-stripping |
| Server orchestration | **Yes** | Real functions, stubbed network only |
| Static analysis (a11y, RLS, route auth, secrets) | **Yes** | Parses real source + migrations |
| SQL functions & migrations | **No** | Statically verified only |
| Browser E2E | **No** | Specs written, never run |
| `npm run build` | **No** | CI does it; I could not |

The runner treats a suite that crashes before printing a summary as
**failed**, so an import error can't masquerade as zero failures. This was
verified with deliberate canary suites.

---

## 9. Production checklist

**Before launch — blocking**
- [ ] All 19 migrations applied in order, no errors
- [ ] Superadmin granted; you can reach `/admin`
- [ ] All §5 required env vars set in the host
- [ ] Merchant image hostnames in `images.remotePatterns` — images render
- [ ] `npm run build` succeeds (CI proves this)
- [ ] One real sync completed; products visible with correct prices
- [ ] Buy Now reaches the merchant with the affiliate tag present
- [ ] `/admin/health` shows no missing critical service
- [ ] `NEXT_PUBLIC_CONTACT_EMAIL` set — the Contact page needs it
- [ ] Privacy, Terms, Affiliate Disclosure reviewed by a lawyer

**Before launch — strongly recommended**
- [ ] `price_ttl_hours` per merchant set just above their real sync interval
- [ ] Email configured and a test alert received
- [ ] Repo secrets set; scheduled workflows running green
- [ ] `robots.txt` and `sitemap.xml` load; sitemap submitted to Search Console
- [ ] Rate limiter swapped to Upstash Redis (current one is per-instance)
- [ ] Tested on a real Android phone, not just a simulator

**First week**
- [ ] Watch `/admin/sync-errors` — early feed problems cluster here
- [ ] Watch attributed-click rate; a drop means affiliate config broke
- [ ] Work the matching review queue while it's small
- [ ] Confirm the rollup job ran and `price_history` isn't growing unbounded

**Known gaps to close**
- [ ] CSP (draft in `next.config.mjs`)
- [ ] Web Push sending (architecture ready, needs VAPID + `web-push`)
- [ ] DPDP: account deletion and data export flows
- [ ] E2E specs: run once and fix selectors

---

## 10. Adding future merchants

### If they offer an XML/CSV feed — no code at all

```sql
insert into public.merchants (name, slug, price_ttl_hours, is_active)
values ('New Store', 'new-store', 24, true);

insert into public.affiliate_configurations (
  merchant_id, network, link_strategy, base_url_template,
  env_var_prefix, tracking_id_env_var, allowed_deep_link_domains, is_active
) values (
  (select id from public.merchants where slug = 'new-store'),
  'their_network', 'deep_link_template',
  'https://their-tracker.example/g/{trackingId}/?ulp={destination}',
  'NEWSTORE', 'NEWSTORE_TRACKING_ID', array['newstore.com'], true
);

insert into public.sync_jobs (
  merchant_id, job_type, connector_key, schedule_interval_minutes, config, is_active
) values (
  (select id from public.merchants where slug = 'new-store'),
  'full_catalog', 'generic_product_feed', 360,
  '{"format":"xml","itemPath":"catalog.offers.offer",
    "mapping":{"externalId":"@id","title":"name","productUrl":"url",
               "price":"price","brand":"vendor","imageUrl":"picture"}}'::jsonb,
  true
);
```

Set `NEWSTORE_FEED_URL` in the host, then press **Sync Now**.

### If they have a bespoke API — one file

1. Create `lib/connectors/<name>/connector.ts` implementing `MerchantConnector`
2. Add one line to `lib/connectors/registry.ts`
3. Insert the `sync_jobs` row with your new `connector_key`

Copy `lib/connectors/flipkart/` as the template. Pagination, retries,
backoff, rate limiting, validation, failure capture, cursor checkpointing,
scheduling and the admin UI all work without modification.

**Rules for any new connector:** never invent an endpoint — read the docs
you receive on approval; leave a field `undefined` rather than deriving it
(especially GTIN); credentials come from env vars only.

---

## 11. Operating everything from Android

You need three apps: **GitHub**, a **browser**, and **Supabase**'s dashboard
in that browser.

| Task | Where |
|---|---|
| Edit code | GitHub app → edit file → commit |
| Run tests | Push; read the Actions tab |
| Deploy | Automatic on push to main |
| Run a migration | Supabase dashboard → SQL Editor |
| Add a merchant | SQL Editor (§10), then `/admin/merchants` |
| Trigger a sync | `/admin/merchants` → **Sync Now** |
| Check what broke | `/admin/health`, then `/admin/sync-errors` |
| Review matches | `/admin/matches` — approve/reject/merge |
| Check earnings | `/admin/affiliate` |
| Force a scheduled job | GitHub → Actions → workflow → **Run workflow** |
| Rotate a secret | Host dashboard → env vars → redeploy |

### The daily loop
1. Open `/admin` — one screen shows products, syncs, failures, clicks
2. Anything red → `/admin/health` for the specific cause
3. Matching queue not empty → clear it while small

### When something breaks
- **No products** → `/admin/health`: is a connector connected and enabled?
  Credentials set? Then `/admin/sync-errors`.
- **Prices look old** → stale-offer count on `/admin/health`. Stale prices
  are *labelled*, not hidden — that's intended.
- **Clicks not earning** → `/admin/affiliate` → link failures. A rising
  `feed_url_missing_tracking_param` means the merchant stopped tagging URLs.
- **Sync stuck "running"** → crashed invocation; press Sync Now again to
  reclaim it. `/admin/health` flags this.

### Practical notes
- The admin UI is built phone-first: sticky header shows the current
  section, navigation is a drawer, data renders as cards not wide tables.
- GitHub's mobile editor handles single-file edits well. For anything
  larger, ask Claude for the complete file and paste it in.
- Migrations are one-way. Read one before running it, and run them in order.
