-- 0012_price_engine.sql
--
-- THE GOVERNING RULE: never present stale data as current.
--
-- Every price the API returns carries a freshness verdict derived from
-- last_checked_at against the merchant's own TTL. Freshness is computed in
-- SQL — not in the UI — so no consumer can accidentally render a
-- three-week-old price as today's price by forgetting a check.
--
-- Storage strategy: raw per-observation rows for a recent window, rolled up
-- to one row per offer per day beyond that. This keeps "lowest price ever"
-- answerable indefinitely without unbounded table growth.

-- ---------------------------------------------------------------------
-- Per-merchant freshness policy
-- ---------------------------------------------------------------------
alter table public.merchants
  add column price_ttl_hours int not null default 24
    check (price_ttl_hours between 1 and 720);

comment on column public.merchants.price_ttl_hours is
  'How long a price from this merchant may be considered CURRENT. Should '
  'be set a little above the merchant''s sync interval — a 6-hourly feed '
  'wants ~8-12h, not 24h. Beyond this the price is stale; beyond 3x it is '
  'expired and is excluded from cheapest-offer selection entirely.';

-- ---------------------------------------------------------------------
-- price_history_daily — permanent rolled-up history
-- ---------------------------------------------------------------------
-- One row per offer per day. Raw price_history rows older than the
-- retention window are collapsed into these and then dropped, so all-time
-- statistics survive while raw storage stays bounded.
create table public.price_history_daily (
  merchant_offer_id uuid not null references public.merchant_offers(id) on delete cascade,
  day date not null,
  min_price numeric(12,2) not null check (min_price >= 0),
  max_price numeric(12,2) not null check (max_price >= 0),
  avg_price numeric(12,2) not null check (avg_price >= 0),
  close_price numeric(12,2) not null check (close_price >= 0),
  mrp numeric(12,2),
  was_in_stock boolean not null default true,
  observations int not null default 1 check (observations > 0),
  primary key (merchant_offer_id, day),
  constraint price_history_daily_range check (max_price >= min_price)
);

create index price_history_daily_day_idx on public.price_history_daily(merchant_offer_id, day desc);

alter table public.price_history_daily enable row level security;
create policy price_history_daily_public_read on public.price_history_daily for select using (true);

-- ---------------------------------------------------------------------
-- rollup_price_history — the storage-efficiency job
-- ---------------------------------------------------------------------
create or replace function public.rollup_price_history(p_retain_days int default 90)
returns table (days_rolled int, rows_collapsed int)
language plpgsql
as $$
declare
  v_cutoff date := (now() - make_interval(days => p_retain_days))::date;
  v_rows int := 0;
  v_days int := 0;
begin
  -- Aggregate everything older than the retention window. ON CONFLICT
  -- makes this safely re-runnable: a partially-completed previous run
  -- updates rather than duplicating.
  with aggregated as (
    select
      ph.merchant_offer_id,
      date(ph.recorded_at) as day,
      min(ph.price) as min_price,
      max(ph.price) as max_price,
      round(avg(ph.price), 2) as avg_price,
      -- Closing price = the last observation of that day.
      (array_agg(ph.price order by ph.recorded_at desc))[1] as close_price,
      max(ph.mrp) as mrp,
      bool_or(ph.in_stock) as was_in_stock,
      count(*)::int as observations
    from public.price_history ph
    where date(ph.recorded_at) < v_cutoff
    group by ph.merchant_offer_id, date(ph.recorded_at)
  ),
  upserted as (
    insert into public.price_history_daily (
      merchant_offer_id, day, min_price, max_price, avg_price, close_price, mrp, was_in_stock, observations
    )
    select merchant_offer_id, day, min_price, max_price, avg_price, close_price, mrp, was_in_stock, observations
    from aggregated
    on conflict (merchant_offer_id, day) do update set
      min_price = least(public.price_history_daily.min_price, excluded.min_price),
      max_price = greatest(public.price_history_daily.max_price, excluded.max_price),
      avg_price = excluded.avg_price,
      close_price = excluded.close_price,
      observations = public.price_history_daily.observations + excluded.observations
    returning 1
  )
  select count(*)::int into v_days from upserted;

  delete from public.price_history ph where date(ph.recorded_at) < v_cutoff;
  get diagnostics v_rows = row_count;

  return query select v_days, v_rows;
end;
$$;

comment on function public.rollup_price_history is
  'Collapses raw price_history older than the retention window into '
  'price_history_daily, then deletes the raw rows. Run on a schedule '
  '(see the sync workflow). Without this, price_history is the '
  'fastest-growing table in the system and the binding constraint on '
  'free-tier storage.';

-- ---------------------------------------------------------------------
-- Freshness classification — the single source of truth
-- ---------------------------------------------------------------------
create or replace function public.price_freshness(
  p_last_checked_at timestamptz,
  p_ttl_hours int
)
returns text
language sql
immutable
as $$
  select case
    when p_last_checked_at is null then 'expired'
    -- >= (not >) so the boundary is inclusive, matching
    -- classifyFreshness() in lib/pricing/engine.ts exactly. A one-second
    -- disagreement between SQL and TS would surface as a price flipping
    -- between "Updated" and "may have changed" on refresh.
    when p_last_checked_at >= now() - make_interval(hours => p_ttl_hours) then 'fresh'
    when p_last_checked_at >= now() - make_interval(hours => p_ttl_hours * 3) then 'stale'
    else 'expired'
  end;
$$;

comment on function public.price_freshness is
  'fresh  = safe to present as the current price. '
  'stale  = show, but must be labelled with its age; still usable for '
  '         cheapest-offer selection since it is the best we have. '
  'expired = too old to be meaningful. EXCLUDED from cheapest-offer '
  '         selection and never described as current.';

-- ---------------------------------------------------------------------
-- get_product_pricing — everything the product page needs, in one call
-- ---------------------------------------------------------------------
-- Returns one row per merchant offer for the product's primary variant,
-- with per-offer freshness, price change vs. the previous observation, and
-- the difference against the best eligible price.
create or replace function public.get_product_pricing(p_product_id uuid)
returns table (
  offer_id uuid,
  merchant_id uuid,
  merchant_name text,
  merchant_slug text,
  merchant_logo_url text,
  price numeric,
  mrp numeric,
  discount_percent numeric,
  in_stock boolean,
  cod_available boolean,
  rating numeric,
  review_count int,
  destination_url text,
  last_checked_at timestamptz,
  freshness text,
  previous_price numeric,
  price_change numeric,
  price_change_percent numeric,
  is_cheapest boolean,
  difference_from_best numeric
)
language sql
stable
as $$
  with primary_variant as (
    select id from public.product_variants
    where product_id = p_product_id and is_active
    order by created_at asc
    limit 1
  ),
  offers as (
    select
      mo.id as offer_id,
      mo.merchant_id,
      m.name as merchant_name,
      m.slug as merchant_slug,
      m.logo_url as merchant_logo_url,
      pr.price,
      pr.mrp,
      case when pr.mrp is not null and pr.mrp > pr.price
        then round(((pr.mrp - pr.price) / pr.mrp) * 100)
        else null end as discount_percent,
      pr.in_stock,
      pr.cod_available,
      pr.rating,
      pr.review_count,
      mo.destination_url,
      pr.last_checked_at,
      public.price_freshness(pr.last_checked_at, m.price_ttl_hours) as freshness,
      -- Previous distinct price for this offer, for change detection.
      (
        select ph.price from public.price_history ph
        where ph.merchant_offer_id = mo.id and ph.price <> pr.price
        order by ph.recorded_at desc
        limit 1
      ) as previous_price
    from public.merchant_offers mo
    join public.prices pr on pr.merchant_offer_id = mo.id
    join public.merchants m on m.id = mo.merchant_id
    where mo.product_variant_id = (select id from primary_variant)
      and mo.is_active
      and m.is_active
  ),
  best as (
    -- Cheapest ELIGIBLE offer: in stock and not expired. An expired price
    -- is never allowed to win, because presenting it as "best" is
    -- presenting stale data as current.
    select min(o.price) as best_price
    from offers o
    where o.in_stock and o.freshness <> 'expired'
  )
  select
    o.offer_id, o.merchant_id, o.merchant_name, o.merchant_slug, o.merchant_logo_url,
    o.price, o.mrp, o.discount_percent, o.in_stock, o.cod_available,
    o.rating, o.review_count, o.destination_url, o.last_checked_at, o.freshness,
    o.previous_price,
    case when o.previous_price is not null then o.price - o.previous_price end as price_change,
    case when o.previous_price is not null and o.previous_price > 0
      then round(((o.price - o.previous_price) / o.previous_price) * 100, 2) end as price_change_percent,
    (b.best_price is not null and o.price = b.best_price and o.in_stock and o.freshness <> 'expired') as is_cheapest,
    case when b.best_price is not null then o.price - b.best_price end as difference_from_best
  from offers o cross join best b
  order by
    -- Eligible offers first, then by price. Expired/out-of-stock sink to
    -- the bottom rather than being hidden — users still want to see them.
    (o.in_stock and o.freshness <> 'expired') desc,
    o.price asc;
$$;

-- ---------------------------------------------------------------------
-- get_price_statistics — lowest/highest recorded, with a data-sufficiency
-- guard so we never claim an "all-time low" from two observations.
-- ---------------------------------------------------------------------
create or replace function public.get_price_statistics(p_product_id uuid)
returns table (
  lowest_price numeric,
  lowest_price_at timestamptz,
  highest_price numeric,
  highest_price_at timestamptz,
  average_price numeric,
  observation_days int,
  observation_count int,
  has_sufficient_data boolean,
  is_at_lowest boolean,
  current_best_price numeric
)
language sql
stable
as $$
  with primary_variant as (
    select id from public.product_variants
    where product_id = p_product_id and is_active
    order by created_at asc limit 1
  ),
  offer_ids as (
    select mo.id from public.merchant_offers mo
    where mo.product_variant_id = (select id from primary_variant) and mo.is_active
  ),
  -- Union raw recent history with the rolled-up daily archive so
  -- statistics span all time, not just the raw retention window.
  combined as (
    select ph.price, ph.recorded_at, date(ph.recorded_at) as day
    from public.price_history ph
    where ph.merchant_offer_id in (select id from offer_ids) and ph.in_stock
    union all
    select d.min_price, d.day::timestamptz, d.day
    from public.price_history_daily d
    where d.merchant_offer_id in (select id from offer_ids) and d.was_in_stock
  ),
  agg as (
    select
      min(price) as lowest_price,
      max(price) as highest_price,
      round(avg(price), 2) as average_price,
      count(distinct day)::int as observation_days,
      count(*)::int as observation_count
    from combined
  ),
  current_best as (
    select min(pr.price) as best
    from public.merchant_offers mo
    join public.prices pr on pr.merchant_offer_id = mo.id
    join public.merchants m on m.id = mo.merchant_id
    where mo.product_variant_id = (select id from primary_variant)
      and mo.is_active and pr.in_stock
      and public.price_freshness(pr.last_checked_at, m.price_ttl_hours) <> 'expired'
  )
  select
    a.lowest_price,
    (select c.recorded_at from combined c where c.price = a.lowest_price order by c.recorded_at desc limit 1),
    a.highest_price,
    (select c.recorded_at from combined c where c.price = a.highest_price order by c.recorded_at desc limit 1),
    a.average_price,
    a.observation_days,
    a.observation_count,
    -- SUFFICIENCY GUARD. "Lowest ever recorded" is a strong claim; making
    -- it from three data points collected yesterday is misleading. Require
    -- a real observation window before the UI may show it.
    (a.observation_days >= 7 and a.observation_count >= 5) as has_sufficient_data,
    (cb.best is not null and a.lowest_price is not null and cb.best <= a.lowest_price) as is_at_lowest,
    cb.best
  from agg a cross join current_best cb;
$$;

comment on function public.get_price_statistics is
  'has_sufficient_data gates the "lowest recorded price" UI. Below 7 '
  'distinct observation days and 5 observations the statistics are '
  'returned but must not be presented as historical lows — see '
  'lib/pricing/ and the product page.';

-- ---------------------------------------------------------------------
-- get_price_drops — powers deals/alerts from real observed changes
-- ---------------------------------------------------------------------
create or replace function public.get_price_drops(
  p_since_hours int default 48,
  p_min_drop_percent numeric default 5,
  p_limit int default 50
)
returns table (
  product_id uuid,
  offer_id uuid,
  merchant_name text,
  current_price numeric,
  previous_price numeric,
  drop_amount numeric,
  drop_percent numeric,
  changed_at timestamptz
)
language sql
stable
as $$
  with recent as (
    select
      ph.merchant_offer_id,
      ph.price,
      ph.recorded_at,
      lag(ph.price) over (partition by ph.merchant_offer_id order by ph.recorded_at) as prev_price
    from public.price_history ph
    where ph.recorded_at > now() - make_interval(hours => p_since_hours)
      and ph.in_stock
  ),
  drops as (
    select
      r.merchant_offer_id,
      r.price as current_price,
      r.prev_price,
      r.prev_price - r.price as drop_amount,
      round(((r.prev_price - r.price) / r.prev_price) * 100, 2) as drop_percent,
      r.recorded_at
    from recent r
    where r.prev_price is not null
      and r.prev_price > r.price
      and r.prev_price > 0
      and ((r.prev_price - r.price) / r.prev_price) * 100 >= p_min_drop_percent
  )
  select
    pv.product_id,
    d.merchant_offer_id,
    m.name,
    d.current_price,
    d.prev_price,
    d.drop_amount,
    d.drop_percent,
    d.recorded_at
  from drops d
  join public.merchant_offers mo on mo.id = d.merchant_offer_id and mo.is_active
  join public.product_variants pv on pv.id = mo.product_variant_id
  join public.merchants m on m.id = mo.merchant_id
  join public.prices pr on pr.merchant_offer_id = mo.id
  -- Only report drops whose price is still current — a drop detected from
  -- a feed that has since gone stale is not actionable.
  where public.price_freshness(pr.last_checked_at, m.price_ttl_hours) <> 'expired'
  order by d.drop_percent desc, d.recorded_at desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------
-- get_stale_offers — operational visibility for the admin dashboard
-- ---------------------------------------------------------------------
create or replace function public.get_stale_offers(p_limit int default 100)
returns table (
  offer_id uuid,
  merchant_name text,
  product_title text,
  price numeric,
  last_checked_at timestamptz,
  hours_since_check numeric,
  freshness text
)
language sql
stable
as $$
  select
    mo.id,
    m.name,
    p.title,
    pr.price,
    pr.last_checked_at,
    round(extract(epoch from (now() - pr.last_checked_at)) / 3600.0, 1),
    public.price_freshness(pr.last_checked_at, m.price_ttl_hours)
  from public.merchant_offers mo
  join public.prices pr on pr.merchant_offer_id = mo.id
  join public.merchants m on m.id = mo.merchant_id
  join public.product_variants pv on pv.id = mo.product_variant_id
  join public.products p on p.id = pv.product_id
  where mo.is_active
    and public.price_freshness(pr.last_checked_at, m.price_ttl_hours) <> 'fresh'
  order by pr.last_checked_at asc
  limit p_limit;
$$;
