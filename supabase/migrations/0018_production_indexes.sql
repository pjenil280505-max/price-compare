-- 0018_production_indexes.sql
--
-- Indexes for the query patterns this application actually runs. Each one
-- names the query it serves — an index nobody can justify is write
-- amplification with no read benefit, and this schema already carries a
-- lot of them.
--
-- CONCURRENTLY is deliberately NOT used: Supabase migrations run inside a
-- transaction, and CREATE INDEX CONCURRENTLY cannot. On a catalog that has
-- not launched these build in milliseconds. Once live with millions of
-- rows, build any further indexes outside the migration runner.

-- ---------------------------------------------------------------------
-- Sitemap generation: products ordered by updated_at, active only.
-- Without this the sitemap does a full scan + sort of the catalog every
-- time it revalidates.
-- ---------------------------------------------------------------------
create index if not exists products_sitemap_idx
  on public.products(updated_at desc)
  where is_active;

-- ---------------------------------------------------------------------
-- Product page: slug lookup is the single hottest query in the app.
-- The existing unique index on slug covers equality, but this partial
-- index is smaller and keeps inactive products out of the hot path.
-- ---------------------------------------------------------------------
create index if not exists products_active_slug_idx
  on public.products(slug)
  where is_active;

-- ---------------------------------------------------------------------
-- Price engine: get_product_pricing joins offers -> prices -> merchants
-- and orders by price. This covering-ish index lets the cheapest-offer
-- lookup be satisfied without visiting the heap for most rows.
-- ---------------------------------------------------------------------
create index if not exists prices_offer_price_stock_idx
  on public.prices(merchant_offer_id, price)
  where in_stock;

-- ---------------------------------------------------------------------
-- Alert evaluation scans active alerts oldest-triggered-first.
-- ---------------------------------------------------------------------
create index if not exists price_alerts_due_idx
  on public.price_alerts(last_triggered_at nulls first)
  where is_active;

-- ---------------------------------------------------------------------
-- Notification history: "my notifications, newest first".
-- notifications_user_unread_idx covers the unread filter; this covers the
-- unfiltered list, which is what the notifications page actually loads.
-- ---------------------------------------------------------------------
create index if not exists notifications_user_recent_idx
  on public.notifications(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Category browsing with an empty text query sorts by recency.
-- ---------------------------------------------------------------------
create index if not exists products_brand_active_idx
  on public.products(brand_id)
  where is_active;

-- ---------------------------------------------------------------------
-- Admin dashboard counts price_history rows in a recent window.
-- ---------------------------------------------------------------------
create index if not exists price_history_recorded_idx
  on public.price_history(recorded_at desc);

-- ---------------------------------------------------------------------
-- Statistics maintenance
-- ---------------------------------------------------------------------
-- The planner's default sample is too small to estimate selectivity well
-- on these columns, which matters for the search function's choice between
-- the full-text and trigram paths.
alter table public.products alter column product_key set statistics 500;
alter table public.products alter column title set statistics 500;
alter table public.prices alter column price set statistics 500;

comment on index public.products_sitemap_idx is
  'Serves app/sitemap.ts. Partial on is_active because the sitemap must '
  'never list a deactivated product — doing so produces soft-404s that '
  'erode crawl trust.';
