-- 0005_offers_and_pricing.sql
-- Three-way split, deliberately:
--   merchant_offers = identity of a listing (this merchant sells this variant)
--   prices          = that listing's current price/stock, updated in place
--   price_history   = an append-only log of every price seen over time
-- Keeping "current state" and "history" separate means the hot path (read
-- current prices for a product page) never has to scan a growing log table.

create table public.merchant_offers (
  id uuid primary key default gen_random_uuid(),
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  -- ASIN / FSN / merchant SKU — whatever the feed uses to identify this
  -- exact listing. Combined with merchant_id, this is what ingestion
  -- upserts on (idempotent re-runs, per the connector architecture doc).
  external_product_id text not null,
  -- Either the feed-provided URL (already affiliate-tagged) or a base URL
  -- to wrap via the network's link-builder at click time — never a
  -- hand-typed link (see the affiliate architecture doc).
  destination_url text not null,
  match_confidence numeric(4,3) check (match_confidence is null or match_confidence between 0 and 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Duplicate prevention: re-ingesting the same feed item upserts this row
  -- instead of creating a second listing for the same merchant SKU.
  unique (merchant_id, external_product_id)
);

create trigger merchant_offers_set_updated_at
  before update on public.merchant_offers
  for each row execute function public.set_updated_at();

create index merchant_offers_variant_id_idx on public.merchant_offers(product_variant_id);
create index merchant_offers_merchant_id_idx on public.merchant_offers(merchant_id);
create index merchant_offers_active_idx on public.merchant_offers(is_active) where is_active;

-- ---------------------------------------------------------------------
-- prices — current state, 1:1 with merchant_offers (no surrogate key
-- needed; the offer's own id is the primary key of its price row).
-- ---------------------------------------------------------------------
create table public.prices (
  merchant_offer_id uuid primary key references public.merchant_offers(id) on delete cascade,
  price numeric(12,2) not null check (price >= 0),
  mrp numeric(12,2) check (mrp is null or mrp >= price),
  currency text not null default 'INR' check (currency = 'INR'),
  in_stock boolean not null default true,
  cod_available boolean not null default false,
  rating numeric(2,1) check (rating is null or rating between 0 and 5),
  review_count int check (review_count is null or review_count >= 0),
  last_checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger prices_set_updated_at
  before update on public.prices
  for each row execute function public.set_updated_at();

-- Powers "cheapest offer" queries (ORDER BY price) and staleness checks.
create index prices_price_idx on public.prices(price);
create index prices_last_checked_at_idx on public.prices(last_checked_at);
create index prices_in_stock_idx on public.prices(in_stock) where in_stock;

-- ---------------------------------------------------------------------
-- price_history — append-only, partitioned by month.
-- ---------------------------------------------------------------------
create table public.price_history (
  id bigint generated always as identity,
  merchant_offer_id uuid not null references public.merchant_offers(id) on delete cascade,
  price numeric(12,2) not null check (price >= 0),
  mrp numeric(12,2),
  in_stock boolean not null default true,
  recorded_at timestamptz not null default now(),
  primary key (id, recorded_at)
) partition by range (recorded_at);

-- Index on the partitioned parent propagates automatically to every
-- partition (Postgres 11+), including ones created later.
create index price_history_offer_id_idx on public.price_history (merchant_offer_id, recorded_at desc);

-- Catch-all so inserts never fail for lack of a matching partition; real
-- monthly partitions (created via the helper function below) get pruning
-- benefits the default partition doesn't.
create table public.price_history_default partition of public.price_history default;

create or replace function public.create_price_history_partition(month_start date)
returns void
language plpgsql
as $$
declare
  partition_name text := 'price_history_' || to_char(month_start, 'YYYY_MM');
  month_end date := month_start + interval '1 month';
begin
  execute format(
    'create table if not exists public.%I partition of public.price_history
       for values from (%L) to (%L)',
    partition_name, month_start, month_end
  );
end;
$$;

comment on function public.create_price_history_partition(date) is
  'Call monthly (e.g. from a GitHub Actions cron hitting a Supabase RPC, '
  'per the architecture doc''s scheduled-jobs design) with the first day '
  'of the month to pre-create that partition. Rows older than ~90 days '
  'should be rolled up into daily aggregates and the raw partition '
  'dropped — that rollup job is a documented next step, not implemented '
  'in this migration set.';

-- Pre-create the current and next month so inserts land in a real
-- partition immediately after this migration runs, not the default one.
select public.create_price_history_partition(date_trunc('month', now())::date);
select public.create_price_history_partition((date_trunc('month', now()) + interval '1 month')::date);
