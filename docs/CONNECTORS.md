# Merchant Connectors

How product data gets into the catalog. **No product, price, image, or link
is ever entered by hand** — every row originates from an authorized
merchant API or product feed, written through a single database function
that no human-facing UI can call.

---

## 1. Required approval and credentials, per merchant

This is the part that gates everything else. Code cannot substitute for
account approval.

### Flipkart Affiliate — implemented ✅

| | |
|---|---|
| **Connector key** | `flipkart_affiliate` |
| **Apply at** | affiliate.flipkart.com |
| **What you need** | Approved affiliate account → generate an **Affiliate Tracking ID** and **API Token** from the dashboard's API section |
| **Sales gate** | None. Self-serve after approval — this is why it's the recommended first merchant |
| **Env vars** | `FLIPKART_AFFILIATE_ID`, `FLIPKART_AFFILIATE_TOKEN` |
| **Docs** | https://affiliate.flipkart.com/api-docs/af_prod_ref.html |

**What Flipkart's feed actually provides** (verified against their official
docs, not assumed):

✅ product id (FSN), title, description, brand, images at multiple
resolutions, category path, MRP, selling price, special price, discount %,
stock status, COD availability, product URL (already affiliate-tagged),
style code, size/color/storage attributes, full specification list, seller
ratings.

❌ **No GTIN / EAN / UPC.** This field simply does not exist in their
affiliate feed. The connector leaves `gtin` undefined rather than
fabricating one. **This has a real consequence:** exact-identifier product
matching cannot work for Flipkart-only items, so cross-merchant matching
must fall back to title/brand/attribute similarity. Don't be surprised when
the same phone from two merchants doesn't auto-merge.

❌ No dedicated model-number field (extracted from specs when present).
❌ Books and eBooks categories are unavailable via this API.

**Operational constraints their docs specify:** feed URLs expire after 10
hours, pages are 500 items, and the `expiresAt`/`sig` query parameters must
not be modified. The connector discovers feed URLs from the Product Feed
Listing API on every run rather than caching them, precisely because of the
expiry.

### Generic product feed (Admitad, CJ, Awin, direct programs) — implemented ✅

| | |
|---|---|
| **Connector key** | `generic_product_feed` |
| **What you need** | Approved publisher account with the network, plus a feed URL |
| **Env vars** | `<PREFIX>_FEED_URL` (put the whole URL here if it embeds a key) |

Most networks don't offer a bespoke REST API — they give approved
publishers an XML or CSV feed URL. Field names differ per network and often
per advertiser, so this connector takes a **field mapping in
`sync_jobs.config`** rather than hard-coding any network's schema. I have
not guessed at any specific network's field names; you supply them from the
feed documentation you receive, or by inspecting the first rows of your
actual feed.

One connector therefore covers unlimited feed-based merchants — adding
another is a database row, not code.

### Amazon — deliberately not implemented ⛔

| | |
|---|---|
| **Connector key** | `amazon_creators` (registered placeholder) |
| **Status** | Blocked on access, not on code |

Two independent blockers: the Product Advertising API (PA-API 5.0) is being
retired in favour of a new OAuth-based Creators API, **and** API access
requires a trailing-30-day flow of qualifying referred sales. A new site
with no sales history cannot obtain credentials regardless of code quality.

I did not write a speculative implementation. Doing so would mean inventing
endpoint paths, request signing, and response shapes for an API whose
current specification I cannot verify — and a connector that *looks*
finished but is built on guessed field names fails in production, against a
live merchant, at the worst possible time. `lib/connectors/amazon/connector.ts`
documents the implementation steps for when access is granted.

Worth prioritizing once eligible: Amazon **does** publish GTIN/EAN/UPC,
which would materially improve product matching that Flipkart alone can't
support.

---

## 2. Adding a merchant later

The architectural promise: **new merchant = new connector file + one
database row. No core system changes.**

### Case A: the merchant offers an XML/CSV feed

No code at all. Insert a `sync_jobs` row:

```sql
insert into public.sync_jobs (
  merchant_id, job_type, connector_key, schedule_interval_minutes, config
) values (
  '<merchant-uuid>',
  'full_catalog',
  'generic_product_feed',
  360,
  '{
    "format": "xml",
    "itemPath": "catalog.offers.offer",
    "mapping": {
      "externalId": "@id",
      "title": "name",
      "productUrl": "url",
      "price": "price",
      "mrp": "oldprice",
      "brand": "vendor",
      "category": "categoryId",
      "description": "description",
      "imageUrl": "picture",
      "inStock": "@available"
    }
  }'::jsonb
);
```

Replace the mapping values with the actual element/column names from *your*
feed. Set `<PREFIX>_FEED_URL` in the environment and
`affiliate_configurations.env_var_prefix` to `<PREFIX>`.

### Case B: the merchant has a bespoke API

1. Create `lib/connectors/<name>/connector.ts` implementing `MerchantConnector`.
2. Add one line to the array in `lib/connectors/registry.ts`.
3. Insert the `sync_jobs` row with your new `connector_key`.

Copy `lib/connectors/flipkart/` as the template. You get pagination,
retries, backoff, rate limiting, validation, failure capture, cursor
checkpointing, scheduling, and the admin UI for free — none of it needs
touching.

---

## 3. Credentials never live in the database

`sync_jobs.config` is readable by every admin and returned by the
connectors API. Credentials go in **environment variables only**, named
`${env_var_prefix}_${CREDENTIAL_NAME}`.

The engine resolves them at run time and fails loudly if any are missing —
an unauthenticated sync that silently returns zero products is far worse
than a clear error. The config PATCH endpoint additionally rejects keys
containing `token`, `secret`, `password`, `key`, etc., as a guard against a
well-meaning admin pasting a credential into the wrong field.

---

## 4. How a sync run works

```
scheduler (GitHub Actions, every 2h)
  └─> POST /api/internal/sync         [shared-secret auth]
        └─> picks jobs where next_run_at is due
              └─> runSync(jobId)
                    ├─ resolve credentials from env      → fail fast if missing
                    ├─ open sync_logs row (status=running)
                    ├─ load cursor from connector_state
                    ├─ for each page the connector yields:
                    │    ├─ Zod-validate every product
                    │    ├─ ingest_normalized_product()   ← the ONLY write path
                    │    ├─ record per-record failures    → sync_failures
                    │    └─ checkpoint cursor             → resumable
                    ├─ deactivate offers not seen (full sync only)
                    └─ close log, set next_run_at
```

**Design decisions worth knowing:**

- **Per-record failures never abort a run.** One malformed feed row
  produces a `sync_failures` entry and the run continues. A feed with 3
  broken items out of 50,000 should import 49,997 products, not zero.
- **Time budget + cursor checkpointing.** Serverless caps request duration,
  so a large catalog spans several runs. The cursor is written after every
  page, so an interrupted run resumes rather than restarting.
- **Price history only records changes.** Writing a row on every check
  would multiply that table's growth by the sync frequency for no added
  information.
- **Deactivation is soft.** Delisted offers get `is_active = false`, so
  `price_history` and `affiliate_clicks` referencing them survive.
- **`deactivate_missing_offers` runs only after a *complete* full sync.**
  After a delta — or a run that hit its time budget — it would wrongly
  deactivate everything the run didn't happen to reach. The engine skips it
  when `timedOut` is true.
- **Backoff on repeated failure.** `consecutive_failures` pushes
  `next_run_at` out exponentially (capped at 24h); past 5 failures the
  scheduler skips the job entirely until an admin re-enables it. This stops
  a broken connector hammering a merchant's API — the kind of thing that
  gets an affiliate account suspended.

---

## 5. Setup checklist

1. Apply to Flipkart Affiliate; get tracking ID + API token.
2. Set `FLIPKART_AFFILIATE_ID` / `FLIPKART_AFFILIATE_TOKEN` in your
   deployment environment (never in the repo).
3. Insert the merchant, its `affiliate_configurations` row with
   `env_var_prefix = 'FLIPKART'`, and a `sync_jobs` row with
   `connector_key = 'flipkart_affiliate'`.
4. Add repository secrets `APP_BASE_URL` and `INTERNAL_CRON_SECRET`.
5. Open `/admin/connectors`, confirm the connector shows as registered,
   and press **Sync Now** — start with a narrow `config.categories` list
   so the first run is small and verifiable.
6. Check `sync_failures` for that run before widening the category list.

---

## 6. Not yet built

Named honestly rather than left to be discovered:

- **Nothing has run against a live merchant API.** The Flipkart connector
  is written against their published schema, but no request has ever been
  made with real credentials. Expect to fix things on first contact —
  especially the `productFamily` / variant handling, which their docs
  describe loosely.
- **No fuzzy/embedding product matching.** `ingest_normalized_product`
  does exact-identifier matching only (existing offer, then GTIN). The
  embedding-based matching described in the platform architecture doc, and
  the `product_match_reviews` queue that depends on it, are a separate
  piece of work. Until then, the same product from two merchants will
  usually create two separate product rows.
- **No image proxying.** Feed image URLs are stored as-is, so every
  merchant CDN hostname must be added to `next.config.mjs`
  `images.remotePatterns` or images won't render.
- **No coupon/offer ingestion.** Flipkart's Offer API and the `coupons`
  table both exist; nothing connects them yet.
- **`schedule_cron` is vestigial.** Scheduling uses
  `schedule_interval_minutes` instead, to avoid shipping a cron parser for
  a scheduler that only asks "what's due now".

---

## 7. Affiliate link configuration

Links are generated at click time from merchant/network configuration.
**No per-product link is stored anywhere** — `/go/{offerId}` derives the
destination from `affiliate_configurations` + the URL the feed supplied.

### Three strategies

| Strategy | When to use | Config needed |
|---|---|---|
| `passthrough` | Feed URLs already carry the tag (Flipkart) | `tracking_param` to verify the tag is present |
| `query_param` | Network documents a param to append | `tracking_param`, `tracking_id_env_var` |
| `deep_link_template` | Network gives a wrapper URL | `base_url_template` with `{destination}` |

### Credentials never go in the database

`affiliate_configurations.tracking_id_env_var` stores the **name** of an
environment variable, never its value. The table is admin-readable and
returned by the admin API — a credential stored there would be exposed.

```sql
insert into public.affiliate_configurations (
  merchant_id, network, link_strategy, tracking_param,
  tracking_id_env_var, allowed_deep_link_domains, is_active
) values (
  '<merchant-uuid>', 'flipkart_affiliate', 'passthrough', 'affid',
  'FLIPKART_AFFILIATE_ID', array['flipkart.com'], true
);
```

### What happens when configuration is wrong

Every failure path falls back to the **plain merchant URL** — untracked, but
correct. The click still works; we just lose that commission. Fabricating or
guessing a link would risk breaking the purchase and breaching the network's
terms, which is strictly worse than losing one attribution.

Fallback reasons are recorded per click and surfaced at `/admin/affiliate`:

| Reason | Meaning |
|---|---|
| `no_config` / `config_inactive` | No active config for this merchant |
| `domain_not_permitted` | Destination outside `allowed_deep_link_domains` |
| `feed_url_missing_tracking_param` | **The feed stopped tagging URLs** — act on this |
| `missing_template` / `unresolved_placeholder:{x}` | Template misconfigured |
| `missing_tracking_id` | The referenced env var isn't set |
| `credential_detected_in_url` | A secret was pasted into config — fix immediately |

A rising untracked rate is the earliest signal that a feed or config broke.

### Click tracking is deliberately minimal

Recorded: offer, merchant, tracked-or-not, coarse device bucket
(mobile/tablet/desktop/bot), platform, internal referrer **path**, and an
opaque rotating session token.

Not recorded: raw User-Agent (a strong fingerprint), IP address, referrer
query strings, or anything correlating a person across sessions. Sub-IDs
sent to networks are stripped to `[a-zA-Z0-9_-]` so an email or user ID
cannot be smuggled into a third party's logs. Raw click rows are pruned
after 180 days via `prune_affiliate_clicks()`.
