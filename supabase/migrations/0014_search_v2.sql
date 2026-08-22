-- 0014_search_v2.sql
--
-- Upgrades search IN PLACE. This does not add a parallel search system —
-- the old public.search_products is dropped and replaced, so there remains
-- exactly one search entry point.
--
-- Three substantive changes over 0009:
--
--   1. PRICE FRESHNESS. The old version computed a product's cheapest
--      price with no freshness check, so an expired price could be shown
--      as a search result's current price — exactly what the price engine
--      exists to prevent. Best price now excludes expired offers via
--      public.price_freshness(), the same function the product page uses.
--
--   2. VARIANT CORRECTNESS. Price is taken from ONE variant, never mixed
--      across variants. Which variant depends on the query: if the user
--      filtered on a spec ("16GB RAM"), the matching variant; otherwise
--      the primary variant, matching get_product_pricing()'s definition.
--
--   3. ONE ROUND TRIP. Returns display-ready rows (best price, merchant,
--      freshness, offer count) instead of bare ids, removing a second
--      hydration query per search — the main mobile latency win.

drop function if exists public.search_products(
  text, text, uuid[], text[], numeric, numeric, numeric, boolean, text, int, int
);

create or replace function public.search_products(
  search_query text default '',
  p_category_slug text default null,
  p_merchant_ids uuid[] default null,
  p_brand_names text[] default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_min_rating numeric default null,
  p_in_stock_only boolean default false,
  p_min_discount numeric default null,
  p_variant_axes jsonb default '{}'::jsonb,
  p_sort text default 'relevance',
  p_limit int default 24,
  p_offset int default 0
)
returns table (
  product_id uuid,
  slug text,
  title text,
  brand_name text,
  category_name text,
  primary_image_url text,
  created_at timestamptz,
  variant_id uuid,
  variant_label text,
  best_offer_id uuid,
  best_price numeric,
  best_mrp numeric,
  best_discount_percent numeric,
  best_in_stock boolean,
  best_freshness text,
  best_last_checked_at timestamptz,
  merchant_id uuid,
  merchant_name text,
  merchant_slug text,
  merchant_logo_url text,
  offer_count int,
  avg_rating numeric,
  total_reviews int,
  relevance real,
  total_count bigint
)
language sql
stable
as $$
  with
  -- Normalize the axis filter once so the lateral below can use @>.
  axis_filter as (
    select case when p_variant_axes = '{}'::jsonb then null else p_variant_axes end as axes
  ),
  matched as (
    select
      p.id,
      p.slug,
      p.title,
      b.name as brand_name,
      c.name as category_name,
      p.primary_image_url,
      p.created_at,
      case
        when coalesce(search_query, '') = '' then 0::real
        else
          -- Full-text rank, with a trigram floor so a typo'd query that
          -- misses FTS entirely still orders sensibly rather than 0.
          greatest(
            ts_rank(p.search_vector, websearch_to_tsquery('english', search_query)),
            similarity(p.title, search_query) * 0.5
          )
      end as relevance
    from public.products p
    left join public.brands b on b.id = p.brand_id
    left join public.categories c on c.id = p.category_id
    where p.is_active
      and (
        coalesce(search_query, '') = ''
        -- TYPO TOLERANCE: either the full-text index matches, or trigram
        -- similarity on the title/product_key is high enough. Both operands
        -- are index-backed (GIN fts + GIN trgm), so Postgres can bitmap-OR
        -- them rather than sequential scanning.
        or p.search_vector @@ websearch_to_tsquery('english', search_query)
        or p.title % search_query
        or (p.product_key is not null and p.product_key % search_query)
      )
      and (p_category_slug is null or c.slug = p_category_slug)
      and (p_brand_names is null or b.name = any(p_brand_names))
  ),
  priced as (
    select
      m.*,
      v.variant_id,
      v.variant_label,
      o.offer_id,
      o.price,
      o.mrp,
      o.discount_percent,
      o.in_stock,
      o.freshness,
      o.last_checked_at,
      o.merchant_id,
      o.merchant_name,
      o.merchant_slug,
      o.merchant_logo_url,
      agg.offer_count,
      agg.avg_rating,
      agg.total_reviews
    from matched m
    -- Pick the target variant: the one matching the spec filter when the
    -- query had one, otherwise the primary (earliest) variant — the same
    -- definition get_product_pricing() uses, so search and product page
    -- never disagree about which variant's price is being shown.
    left join lateral (
      select pv.id as variant_id, pv.label as variant_label
      from public.product_variants pv
      where pv.product_id = m.id
        and pv.is_active
        and (
          (select axes from axis_filter) is null
          or pv.variant_axes @> (select axes from axis_filter)
        )
      order by pv.created_at asc
      limit 1
    ) v on true
    -- Cheapest ELIGIBLE offer on that variant. Expired prices are excluded
    -- outright: they may never be presented as a current best price.
    left join lateral (
      select
        mo.id as offer_id,
        pr.price,
        pr.mrp,
        case when pr.mrp is not null and pr.mrp > pr.price
          then round(((pr.mrp - pr.price) / pr.mrp) * 100) end as discount_percent,
        pr.in_stock,
        public.price_freshness(pr.last_checked_at, mr.price_ttl_hours) as freshness,
        pr.last_checked_at,
        mr.id as merchant_id,
        mr.name as merchant_name,
        mr.slug as merchant_slug,
        mr.logo_url as merchant_logo_url
      from public.merchant_offers mo
      join public.prices pr on pr.merchant_offer_id = mo.id
      join public.merchants mr on mr.id = mo.merchant_id and mr.is_active
      where mo.product_variant_id = v.variant_id
        and mo.is_active
        and pr.in_stock
        and public.price_freshness(pr.last_checked_at, mr.price_ttl_hours) <> 'expired'
        and (p_merchant_ids is null or mo.merchant_id = any(p_merchant_ids))
      order by pr.price asc
      limit 1
    ) o on true
    -- Counts/ratings across the same variant's eligible offers only.
    left join lateral (
      select
        count(*)::int as offer_count,
        round(avg(pr.rating), 2) as avg_rating,
        coalesce(sum(pr.review_count), 0)::int as total_reviews
      from public.merchant_offers mo
      join public.prices pr on pr.merchant_offer_id = mo.id
      join public.merchants mr on mr.id = mo.merchant_id and mr.is_active
      where mo.product_variant_id = v.variant_id
        and mo.is_active
        and public.price_freshness(pr.last_checked_at, mr.price_ttl_hours) <> 'expired'
    ) agg on true
    where v.variant_id is not null
  ),
  filtered as (
    select p.*, count(*) over() as total_count
    from priced p
    where
      -- in_stock_only additionally requires a usable price to exist.
      (not p_in_stock_only or (p.in_stock and p.price is not null))
      and (p_min_price is null or p.price >= p_min_price)
      and (p_max_price is null or p.price <= p_max_price)
      and (p_min_rating is null or p.avg_rating >= p_min_rating)
      and (p_min_discount is null or coalesce(p.discount_percent, 0) >= p_min_discount)
      -- A product with no eligible (non-expired, in-stock) offer is still
      -- shown for a text query — users look up products that are currently
      -- unavailable — but is excluded whenever a price constraint was
      -- given, since we cannot prove it satisfies one.
      and (
        p.price is not null
        or (p_min_price is null and p_max_price is null and p_min_discount is null and not p_in_stock_only)
      )
  )
  select
    f.id, f.slug, f.title, f.brand_name, f.category_name, f.primary_image_url, f.created_at,
    f.variant_id, f.variant_label,
    f.offer_id, f.price, f.mrp, f.discount_percent, f.in_stock, f.freshness, f.last_checked_at,
    f.merchant_id, f.merchant_name, f.merchant_slug, f.merchant_logo_url,
    coalesce(f.offer_count, 0), f.avg_rating, coalesce(f.total_reviews, 0),
    f.relevance, f.total_count
  from filtered f
  order by
    -- Products with a usable current price always outrank those without,
    -- regardless of sort — a result you cannot buy is less useful.
    (f.price is not null) desc,
    case when p_sort = 'price_low_high' then f.price end asc nulls last,
    case when p_sort = 'price_high_low' then f.price end desc nulls last,
    case when p_sort = 'discount' then coalesce(f.discount_percent, 0) end desc nulls last,
    case when p_sort = 'rating' then f.avg_rating end desc nulls last,
    case when p_sort = 'newest' then f.created_at end desc,
    f.relevance desc,
    -- Deterministic tiebreak. Without this, rows with equal sort keys can
    -- come back in a different order per page, causing duplicates and
    -- omissions across pagination.
    f.id asc
  limit p_limit offset p_offset;
$$;

comment on function public.search_products is
  'The single search entry point. Freshness-aware (expired prices never '
  'appear as a best price), variant-correct (one variant per row, never '
  'mixed), typo-tolerant (FTS with trigram fallback), and deterministically '
  'ordered so pagination is stable.';

-- ---------------------------------------------------------------------
-- Autocomplete — upgraded for typo tolerance and category/brand results
-- ---------------------------------------------------------------------
drop function if exists public.search_suggestions(text, int);

create or replace function public.search_suggestions(
  search_query text,
  p_limit int default 8
)
returns table (id uuid, type text, label text, image_url text, subtitle text, score real)
language sql
stable
as $$
  with q as (select coalesce(nullif(trim(search_query), ''), null) as term)
  select * from (
    -- Products: trigram similarity handles typos; prefix matches rank top.
    select
      p.id,
      'product'::text,
      p.title,
      p.primary_image_url,
      b.name,
      (similarity(p.title, (select term from q))
        + case when p.title ilike (select term from q) || '%' then 0.3 else 0 end)::real as score
    from public.products p
    left join public.brands b on b.id = p.brand_id
    where p.is_active
      and (select term from q) is not null
      and (p.title % (select term from q) or p.title ilike (select term from q) || '%')

    union all

    select
      b.id, 'brand'::text, b.name, b.logo_url, null::text,
      (similarity(b.name, (select term from q)) + 0.1)::real
    from public.brands b
    where (select term from q) is not null
      and (b.name % (select term from q) or b.name ilike (select term from q) || '%')

    union all

    select
      c.id, 'category'::text, c.name, c.image_url, null::text,
      (similarity(c.name, (select term from q)) + 0.1)::real
    from public.categories c
    where (select term from q) is not null
      and (c.name % (select term from q) or c.name ilike (select term from q) || '%')
  ) s
  order by s.score desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------
-- Indexes for the new access patterns
-- ---------------------------------------------------------------------
-- Trigram indexes backing typo-tolerant autocomplete on brand/category.
create index if not exists brands_name_trgm_suggest_idx on public.brands using gin (name gin_trgm_ops);
create index if not exists categories_name_trgm_idx on public.categories using gin (name gin_trgm_ops);

-- The search lateral filters offers by variant then orders by price.
create index if not exists merchant_offers_variant_active_idx
  on public.merchant_offers(product_variant_id) where is_active;

-- last_checked_at drives every freshness computation in the search path.
create index if not exists prices_freshness_idx
  on public.prices(last_checked_at, price) where in_stock;

-- Category browsing (empty text query) sorts by recency.
create index if not exists products_category_created_idx
  on public.products(category_id, created_at desc) where is_active;
