# Database Design Notes

Schema lives in `supabase/migrations/`, applied in filename order. This
documents the reasoning, the indexing strategy, and where it will strain
first.

---

## 1. Running the migrations

```
supabase link --project-ref <your-project-ref>
supabase db push
```

Migrations must run in order — `0002` defines `is_admin()`, which every
later RLS policy depends on. `0001` requires the `vector` extension to be
available on your Supabase plan (used for product matching/alternatives).

---

## 2. The core shape

```
brands ─┐
        ├─→ products ──→ product_variants ──→ merchant_offers ──→ prices
categories ─┘                                        │                (current)
                                merchants ───────────┤
                                                     └──→ price_history
                                                              (log)
```

**Three-level product model.** `products` is the canonical thing ("iPhone
15"), `product_variants` is a specific configuration ("128GB, Blue"), and
`merchant_offers` is one store's listing of that variant. Price comparison
only makes sense at the variant level — comparing a 128GB listing against a
256GB one under a single "cheapest price" would be misleading. This is why
`mapProductRow()` scopes `Product.offers` to one primary variant.

**`prices` split from `merchant_offers`.** Price/stock change constantly
while listing identity doesn't. Separating them keeps the hot write path
(price refresh) off the table that FKs point at.

**`price_history` split from `prices`.** `prices` holds current state,
updated in place; `price_history` is an append-only log. The product page
reads current prices without ever scanning a growing log table.

---

## 3. Duplicate prevention

| Constraint | Prevents |
|---|---|
| `products.gtin` unique (partial, where not null) | Two feed items with the same barcode becoming two products |
| `merchant_offers (merchant_id, external_product_id)` unique | Re-ingesting a feed creating duplicate listings — makes ingestion idempotent |
| `wishlists (user_id, product_id)` unique | Saving the same product twice |
| `price_alerts` expression unique index | Duplicate alerts (see below) |
| `product_variants (product_id, label)` unique | Duplicate variants |
| `affiliate_configurations (merchant_id, network)` unique | Two configs for the same merchant+network |

### The price_alerts case is worth understanding

A plain `unique (user_id, product_id, product_variant_id)` would **not**
work, because Postgres treats NULLs as distinct in unique constraints — a
user could create unlimited duplicate alerts by leaving `variant_id` NULL.
The fix is an expression index coalescing NULL to a sentinel UUID:

```sql
create unique index price_alerts_unique_target_idx on public.price_alerts (
  user_id, product_id, coalesce(product_variant_id, '000...0'::uuid)
);
```

**Consequence for application code:** PostgREST's `.upsert({ onConflict })`
matches *column names* against an index, not arbitrary expressions, so it
cannot target this index. `/api/alerts` POST therefore does an explicit
check-then-write. The unique index still backstops a genuine race.

---

## 4. Indexing strategy

Every index exists for a specific query, not speculatively.

**Search.** `products.search_vector` is a generated `tsvector` (title
weighted A, description C) with a GIN index — the primary search path.
`products_title_trgm_idx` (GIN + `gin_trgm_ops`) backs typo-tolerant
autocomplete via `similarity()`.

**Cheapest-offer.** `prices_price_idx` for `ORDER BY price`;
`prices_in_stock_idx` is partial (`where in_stock`) since stock filtering
almost always wants in-stock rows.

**Partial indexes for active rows.** `products_is_active_idx`,
`merchants_is_active_idx`, `merchant_offers_active_idx`,
`product_match_reviews_status_idx` are all partial. Inactive rows are dead
weight in an index that only ever queries active ones.

**Composite index column order matters.** `notifications_user_unread_idx` is
`(user_id, is_read, created_at desc)` — exactly matching "my unread
notifications, newest first."

A real bug caught during this build: `affiliate_clicks` originally only had
`(merchant_offer_id, clicked_at desc)`, but `get_trending_products` filters
by `clicked_at` alone with no `merchant_offer_id` — wrong leading column, so
that index couldn't be used. `affiliate_clicks_clicked_at_idx` was added.

**Vector index.** `ivfflat` with `lists = 100`, suitable for a catalog in
the thousands-to-low-millions. Retune to roughly `sqrt(row_count)` once real
size is known.

---

## 5. Partitioning

`price_history` is range-partitioned by month on `recorded_at`. It's the
fastest-growing table by far (one row per offer per price check).

- `create_price_history_partition(month_start date)` pre-creates a month.
  **Call it monthly from a scheduled job** — current and next month are
  pre-created by the migration, but nothing creates future ones
  automatically.
- A `price_history_default` catch-all exists so inserts never fail for lack
  of a partition, but rows there don't get pruning benefits.
- **Not yet implemented:** the rollup job. Raw rows older than ~90 days
  should be aggregated into daily min/max/avg and the raw partition
  dropped. Without this, the free-tier 500MB limit is the binding
  constraint. This is the single most important operational task not yet
  built.

---

## 6. Why complex queries are SQL functions

Search, trending, alternatives, deals, price history, and current-price
lookup are Postgres functions called via `supabase.rpc(...)` rather than
chained PostgREST query-builder calls.

Filtering/sorting/paginating across `products → variants → offers → prices`
needs real joins, correlated aggregates, and a `count(*) over()` window for
total results. The query builder can't express that reliably — attempting it
leads to over-fetching and client-side filtering, which breaks pagination
correctness. Keeping this logic in SQL also means it's reviewable in one
place and the query planner can optimize it as a whole.

`search_products` returns *identifiers only*; the API layer hydrates full
product detail through the single nested select in `lib/server/products.ts`.
One place shapes a `Product`, so no endpoint can drift.

---

## 7. Scaling notes — where this strains first

**1. `search_products` correlated subqueries.** Cheapest price, best
discount, and average rating are recomputed per product on every search.
Fine at moderate catalog size given the indexes, but this is the first thing
to fix. The remedy: denormalize `cheapest_price` / `best_discount` onto
`products`, refreshed by trigger on `prices` update. Deliberately not done
yet — premature without real data.

**2. Filter option bounds are global.** `getFilterOptions()` returns
min/max price across the *entire* catalog, not the current result set, so
the price-range slider bounds don't narrow as you filter. Correct-looking
but imprecise; fixing it means computing bounds inside `search_products`.

**3. `getMerchants()` counts offers, not distinct products.** A merchant
listing 3 variants of one product counts as 3. Displayed as "products" —
mildly overstated. Needs a distinct-product count if precision matters.

**4. No caching layer.** Every request hits Postgres. `categories`,
`merchants`, and `trending` are near-static and ideal for Upstash Redis or
Next.js `revalidate` — worth adding before real traffic.

**5. `price_history` growth.** See §5. The rollup job is the binding
constraint on free-tier storage.

---

## 8. Reference data vs. seed data

`0002` inserts three rows into `roles` (superadmin/admin/editor). This is
**reference data** — structural rows the app can't function without — not
sample content. No migration inserts any product, merchant, price, or user
data. There is no seed script, by design: the catalog may only be populated
by ingestion connectors.

**Granting the first admin** therefore has to be done manually, once,
against your own database:

```sql
insert into public.admin_users (user_id, role_id)
values (
  (select id from auth.users where email = 'you@example.com'),
  (select id from public.roles where name = 'superadmin')
);
```

---

## 9. Generated types

`lib/server/dbTypes.ts` is hand-written because there's no live Supabase
instance to generate against. Once one exists, prefer:

```
supabase gen types typescript --linked > lib/server/database.types.ts
```

and replace the hand-written shapes — generated types can't drift from the
schema the way hand-maintained ones can.
