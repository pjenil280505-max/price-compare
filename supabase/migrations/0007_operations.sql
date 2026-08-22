-- 0007_operations.sql
-- Ingestion/admin operational tables. None of these are touched by regular
-- user traffic — connectors write via the service role (bypassing RLS by
-- design; see docs/SECURITY.md), and admins read/act through the admin API.

create table public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  job_type text not null check (job_type in ('full_catalog', 'delta_price', 'delta_stock')),
  schedule_cron text,
  is_active boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, job_type)
);

create trigger sync_jobs_set_updated_at
  before update on public.sync_jobs
  for each row execute function public.set_updated_at();

create index sync_jobs_next_run_at_idx on public.sync_jobs(next_run_at) where is_active;

-- ---------------------------------------------------------------------
-- sync_logs
-- ---------------------------------------------------------------------
create table public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid not null references public.sync_jobs(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_processed int not null default 0 check (items_processed >= 0),
  items_matched int not null default 0 check (items_matched >= 0),
  items_flagged int not null default 0 check (items_flagged >= 0),
  error_message text,
  constraint sync_logs_finished_after_started check (finished_at is null or finished_at >= started_at)
);

create index sync_logs_job_id_idx on public.sync_logs(sync_job_id, started_at desc);
create index sync_logs_status_idx on public.sync_logs(status) where status = 'running';

-- ---------------------------------------------------------------------
-- product_match_reviews — the admin queue described in the matching
-- architecture doc (auto-merge above a high confidence threshold happens
-- in the ingestion pipeline and never creates a row here at all; this
-- table only holds the ambiguous middle band that needs a human).
-- ---------------------------------------------------------------------
create table public.product_match_reviews (
  id uuid primary key default gen_random_uuid(),
  merchant_offer_id uuid not null references public.merchant_offers(id) on delete cascade,
  candidate_product_id uuid not null references public.products(id) on delete cascade,
  confidence_score numeric(4,3) not null check (confidence_score between 0 and 1),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'merged')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (merchant_offer_id, candidate_product_id)
);

create index product_match_reviews_status_idx on public.product_match_reviews(status, created_at) where status = 'pending';

-- ---------------------------------------------------------------------
-- coupons (coupons/offers)
-- ---------------------------------------------------------------------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  code text,
  title text not null,
  description text,
  discount_type text not null check (discount_type in ('percentage', 'flat', 'cashback')),
  discount_value numeric(10,2) not null check (discount_value >= 0),
  min_order_value numeric(12,2) check (min_order_value is null or min_order_value >= 0),
  valid_from timestamptz,
  valid_until timestamptz,
  source_feed text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_valid_range check (valid_until is null or valid_from is null or valid_until > valid_from)
);

create trigger coupons_set_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

create index coupons_merchant_id_idx on public.coupons(merchant_id);
create index coupons_active_valid_idx on public.coupons(is_active, valid_until) where is_active;

-- ---------------------------------------------------------------------
-- affiliate_clicks — high-volume append-only log. bigint identity (not
-- uuid) deliberately: smaller index, faster inserts at the volume a
-- redirect endpoint can generate, and nothing ever looks up a click by a
-- client-supplied id.
-- ---------------------------------------------------------------------
create table public.affiliate_clicks (
  id bigint generated always as identity primary key,
  merchant_offer_id uuid not null references public.merchant_offers(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  session_id text,
  destination_url text not null,
  referrer_path text,
  user_agent text,
  clicked_at timestamptz not null default now()
);

create index affiliate_clicks_offer_id_idx on public.affiliate_clicks(merchant_offer_id, clicked_at desc);
create index affiliate_clicks_user_id_idx on public.affiliate_clicks(user_id) where user_id is not null;
-- Supports "clicks in the last N days" queries (get_trending_products in
-- 0009) that filter by recency alone, without a merchant_offer_id — the
-- composite index above has the wrong leading column for that access
-- pattern.
create index affiliate_clicks_clicked_at_idx on public.affiliate_clicks(clicked_at desc);
