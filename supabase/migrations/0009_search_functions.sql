-- 0009_search_functions.sql
-- Search, trending, alternatives, and deals as SQL functions (called via
-- supabase.rpc(...)) rather than PostgREST's embedded-resource query
-- builder. Filtering/sorting/pagination across products -> variants ->
-- offers -> prices needs real joins and window functions that the
-- query-builder syntax can't express reliably — see docs/DATABASE.md.
-- Each function returns identifiers only; the API layer hydrates full
-- product detail via the nested select in lib/server/products.ts, so
-- there is exactly one place that shapes a "Product" for the frontend.

-- ---------------------------------------------------------------------
-- search_products — powers the Search/Results and category pages.
-- ---------------------------------------------------------------------
create or replace function public.search_products(
  search_query text default '',
  p_category_slug text default null,
  p_merchant_ids uuid[] default null,
  p_brand_names text[] default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_min_rating numeric default null,
  p_in_stock_only boolean default false,
  p_sort text default 'relevance',
  p_limit int default 24,
  p_offset int default 0
)
returns table (product_id uuid, total_count bigint)
language sql
stable
as $$
  with matched as (
    select
      p.id as product_id,
      p.created_at,
      (
        select min(pr.price)
        from public.product_variants pv
        join public.merchant_offers mo on mo.product_variant_id = pv.id and mo.is_active
        join public.prices pr on pr.merchant_offer_id = mo.id
        where pv.product_id = p.id and (not p_in_stock_only or pr.in_stock)
      ) as cheapest_price,
      (
        select max(case when pr.mrp is not null and pr.mrp > pr.price
                    then round(((pr.mrp - pr.price) / pr.mrp) * 100) else 0 end)
        from public.product_variants pv
        join public.merchant_offers mo on mo.product_variant_id = pv.id and mo.is_active
        join public.prices pr on pr.merchant_offer_id = mo.id
        where pv.product_id = p.id
      ) as best_discount,
      (
        select avg(pr.rating)
        from public.product_variants pv
        join public.merchant_offers mo on mo.product_variant_id = pv.id and mo.is_active
        join public.prices pr on pr.merchant_offer_id = mo.id
        where pv.product_id = p.id and pr.rating is not null
      ) as avg_rating,
      case
        when search_query = '' then 0::real
        else ts_rank(p.search_vector, websearch_to_tsquery('english', search_query))
      end as rank
    from public.products p
    left join public.categories c on c.id = p.category_id
    left join public.brands b on b.id = p.brand_id
    where p.is_active
      and (search_query = '' or p.search_vector @@ websearch_to_tsquery('english', search_query))
      and (p_category_slug is null or c.slug = p_category_slug)
      and (p_brand_names is null or b.name = any(p_brand_names))
      and (
        p_merchant_ids is null or exists (
          select 1
          from public.product_variants pv
          join public.merchant_offers mo on mo.product_variant_id = pv.id and mo.is_active
          where pv.product_id = p.id and mo.merchant_id = any(p_merchant_ids)
        )
      )
  )
  select m.product_id, count(*) over() as total_count
  from matched m
  where (p_min_price is null or m.cheapest_price >= p_min_price)
    and (p_max_price is null or m.cheapest_price <= p_max_price)
    and (p_min_rating is null or m.avg_rating >= p_min_rating)
    and (not p_in_stock_only or m.cheapest_price is not null)
  order by
    case when p_sort = 'price_low_high' then m.cheapest_price end asc nulls last,
    case when p_sort = 'price_high_low' then m.cheapest_price end desc nulls last,
    case when p_sort = 'discount' then m.best_discount end desc nulls last,
    case when p_sort = 'rating' then m.avg_rating end desc nulls last,
    case when p_sort = 'newest' then m.created_at end desc,
    m.rank desc,
    m.created_at desc
  limit p_limit offset p_offset;
$$;

comment on function public.search_products is
  'Returns matching product_ids + a total_count window column. search_query '
  'may be empty (category browsing with no text query). All filters are '
  'optional and combine with AND. Correlated subqueries recompute cheapest '
  'price/discount/rating per product on every call — fine at moderate '
  'catalog size given the indexes in 0004/0005, but the first thing to '
  'revisit (a denormalized products.cheapest_price column, refreshed on '
  'price update) if this becomes a bottleneck at large catalog size; see '
  'docs/DATABASE.md "Scaling notes".';

-- ---------------------------------------------------------------------
-- search_suggestions — autocomplete, trigram similarity (typo-tolerant).
-- ---------------------------------------------------------------------
create or replace function public.search_suggestions(search_query text, p_limit int default 8)
returns table (id uuid, type text, label text, image_url text, subtitle text)
language sql
stable
as $$
  select p.id, 'product'::text as type, p.title as label, p.primary_image_url as image_url,
         b.name as subtitle
  from public.products p
  left join public.brands b on b.id = p.brand_id
  where p.is_active and similarity(p.title, search_query) > 0.15
  order by similarity(p.title, search_query) desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------
-- get_trending_products — most-clicked in the last 7 days, falling back
-- to newest products when there isn't enough click data yet (a fresh
-- catalog has zero clicks; this must still return something sensible).
-- ---------------------------------------------------------------------
create or replace function public.get_trending_products(p_limit int default 12)
returns table (product_id uuid)
language sql
stable
as $$
  with recent_clicks as (
    select pv.product_id, count(*) as click_count
    from public.affiliate_clicks ac
    join public.merchant_offers mo on mo.id = ac.merchant_offer_id
    join public.product_variants pv on pv.id = mo.product_variant_id
    where ac.clicked_at > now() - interval '7 days'
    group by pv.product_id
  )
  select p.id as product_id
  from public.products p
  left join recent_clicks rc on rc.product_id = p.id
  where p.is_active
  order by coalesce(rc.click_count, 0) desc, p.created_at desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------
-- get_product_alternatives — embedding similarity, falling back to
-- same-category when the source product has no embedding yet (populated
-- by the external matching pipeline, not this app — see 0004's comment).
-- ---------------------------------------------------------------------
create or replace function public.get_product_alternatives(p_product_id uuid, p_limit int default 8)
returns table (product_id uuid)
language plpgsql
stable
as $$
declare
  target_embedding vector(1536);
  target_category_id uuid;
begin
  select embedding, category_id into target_embedding, target_category_id
  from public.products where id = p_product_id;

  if target_embedding is not null then
    return query
      select p.id
      from public.products p
      where p.is_active and p.id <> p_product_id and p.embedding is not null
      order by p.embedding <=> target_embedding
      limit p_limit;
  elsif target_category_id is not null then
    return query
      select p.id
      from public.products p
      where p.is_active and p.id <> p_product_id and p.category_id = target_category_id
      order by p.created_at desc
      limit p_limit;
  end if;
  return;
end;
$$;

-- ---------------------------------------------------------------------
-- get_price_history — daily cheapest price across a product's primary
-- variant's offers (the same "primary variant" scoping used for
-- Product.offers in lib/server/products.ts, so the chart and the buy box
-- never disagree about which variant they're describing).
-- ---------------------------------------------------------------------
create or replace function public.get_price_history(p_product_id uuid, p_range_days int default 90)
returns table (day date, price numeric, mrp numeric, in_stock boolean)
language sql
stable
as $$
  with primary_variant as (
    select id
    from public.product_variants
    where product_id = p_product_id and is_active
    order by created_at asc
    limit 1
  ),
  relevant_offers as (
    select mo.id
    from public.merchant_offers mo
    where mo.product_variant_id = (select id from primary_variant) and mo.is_active
  ),
  daily as (
    select
      date(ph.recorded_at) as day,
      min(ph.price) as price,
      max(ph.mrp) as mrp,
      bool_or(ph.in_stock) as in_stock
    from public.price_history ph
    where ph.merchant_offer_id in (select id from relevant_offers)
      and ph.recorded_at > now() - (p_range_days || ' days')::interval
    group by date(ph.recorded_at)
  )
  select day, price, mrp, in_stock from daily order by day asc;
$$;

comment on function public.get_price_history is
  'One point per calendar day: the cheapest price seen that day across '
  'the product''s primary variant''s active offers. Returns zero rows for '
  'a product with no price_history yet — callers must handle an empty '
  'series (PriceHistoryChart already does, per the component library).';

-- ---------------------------------------------------------------------
-- get_current_prices — cheapest active in-stock price per product, for a
-- batch of product ids at once (price_alerts list endpoint: one call
-- instead of one query per alert row).
-- ---------------------------------------------------------------------
create or replace function public.get_current_prices(p_product_ids uuid[])
returns table (product_id uuid, current_price numeric)
language sql
stable
as $$
  select pv.product_id, min(pr.price) as current_price
  from public.product_variants pv
  join public.merchant_offers mo on mo.product_variant_id = pv.id and mo.is_active
  join public.prices pr on pr.merchant_offer_id = mo.id and pr.in_stock
  where pv.product_id = any(p_product_ids)
  group by pv.product_id;
$$;

-- ---------------------------------------------------------------------
-- get_deals — active offers currently discounted vs. their MRP.
-- ---------------------------------------------------------------------
create or replace function public.get_deals(p_category_slug text default null, p_limit int default 24)
returns table (merchant_offer_id uuid, discount_percent numeric)
language sql
stable
as $$
  select mo.id as merchant_offer_id,
         round(((pr.mrp - pr.price) / pr.mrp) * 100) as discount_percent
  from public.merchant_offers mo
  join public.prices pr on pr.merchant_offer_id = mo.id
  join public.product_variants pv on pv.id = mo.product_variant_id
  join public.products p on p.id = pv.product_id
  left join public.categories c on c.id = p.category_id
  where mo.is_active
    and pr.in_stock
    and pr.mrp is not null
    and pr.mrp > pr.price
    and p.is_active
    and (p_category_slug is null or c.slug = p_category_slug)
  order by discount_percent desc, pr.last_checked_at desc
  limit p_limit;
$$;
