-- 0016_admin_rbac.sql
--
-- Fills in the permission sets the seeded roles carry, and adds the
-- aggregate queries the dashboard needs.
--
-- Roles were seeded in 0002 with a placeholder permission map. Now that
-- lib/server/rbac.ts defines the canonical permission list, the rows are
-- updated to match it. Without this, every non-superadmin would be denied
-- everything, because requirePermission() looks for keys that did not
-- previously exist.

update public.roles
set permissions = '{
  "*": true
}'::jsonb
where name = 'superadmin';

update public.roles
set
  description = 'Operate connectors, matching, deals and analytics. Cannot manage admins or view credentials.',
  permissions = '{
    "view_dashboard": true,
    "manage_connectors": true,
    "manage_affiliate": true,
    "review_matches": true,
    "merge_products": true,
    "manage_deals": true,
    "view_users": true,
    "view_analytics": true,
    "view_audit_log": true
  }'::jsonb
where name = 'admin';

update public.roles
set
  description = 'Review product matches and moderate deals only.',
  permissions = '{
    "view_dashboard": true,
    "review_matches": true,
    "manage_deals": true,
    "view_analytics": true
  }'::jsonb
where name = 'editor';

-- A read-only role. Useful for giving someone visibility without any
-- ability to change catalog state.
insert into public.roles (name, description, permissions)
values (
  'viewer',
  'Read-only access to the dashboard and analytics.',
  '{"view_dashboard": true, "view_analytics": true}'::jsonb
)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- get_admin_dashboard — the Overview section, in one round trip
-- ---------------------------------------------------------------------
-- A dashboard that fires fifteen queries is slow on mobile data. This
-- returns every headline figure at once.
create or replace function public.get_admin_dashboard(p_since_days int default 7)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'products', (select count(*) from public.products where is_active),
    'products_total', (select count(*) from public.products),
    'variants', (select count(*) from public.product_variants where is_active),
    'offers', (select count(*) from public.merchant_offers where is_active),
    'merchants_active', (select count(*) from public.merchants where is_active),
    'merchants_total', (select count(*) from public.merchants),
    'connectors_active', (select count(*) from public.sync_jobs where is_active),
    'pending_matches', (select count(*) from public.product_match_reviews where status = 'pending'),
    'users', (select count(*) from public.profiles),
    'active_alerts', (select count(*) from public.price_alerts where is_active),
    'wishlist_items', (select count(*) from public.wishlists),
    'latest_sync', (
      select jsonb_build_object(
        'id', sl.id, 'status', sl.status, 'started_at', sl.started_at,
        'finished_at', sl.finished_at, 'items_matched', sl.items_matched,
        'merchant', m.name
      )
      from public.sync_logs sl
      join public.sync_jobs sj on sj.id = sl.sync_job_id
      join public.merchants m on m.id = sj.merchant_id
      order by sl.started_at desc limit 1
    ),
    'failed_syncs', (
      select count(*) from public.sync_logs
      where status = 'error' and started_at > now() - make_interval(days => p_since_days)
    ),
    'sync_failures', (
      select count(*) from public.sync_failures sf
      join public.sync_logs sl on sl.id = sf.sync_log_id
      where sl.started_at > now() - make_interval(days => p_since_days)
    ),
    'price_changes', (
      select count(*) from public.price_history
      where recorded_at > now() - make_interval(days => p_since_days)
    ),
    'price_drops', (
      select count(*) from (
        select ph.price, lag(ph.price) over (partition by ph.merchant_offer_id order by ph.recorded_at) as prev
        from public.price_history ph
        where ph.recorded_at > now() - make_interval(days => p_since_days)
      ) t where t.prev is not null and t.price < t.prev
    ),
    'clicks', (
      select count(*) from public.affiliate_clicks
      where clicked_at > now() - make_interval(days => p_since_days)
    ),
    'clicks_untracked', (
      select count(*) from public.affiliate_clicks
      where clicked_at > now() - make_interval(days => p_since_days)
        and link_outcome = 'fallback_untracked'
    ),
    'stale_offers', (
      select count(*)
      from public.merchant_offers mo
      join public.prices pr on pr.merchant_offer_id = mo.id
      join public.merchants m on m.id = mo.merchant_id
      where mo.is_active
        and public.price_freshness(pr.last_checked_at, m.price_ttl_hours) <> 'fresh'
    )
  );
$$;

comment on function public.get_admin_dashboard is
  'Every Overview headline figure in one query. Deliberately a single '
  'round trip: a dashboard opened on mobile data should not fan out into '
  'fifteen separate requests.';

-- ---------------------------------------------------------------------
-- get_merchant_summary — the Merchants section
-- ---------------------------------------------------------------------
create or replace function public.get_merchant_summary()
returns table (
  merchant_id uuid,
  name text,
  slug text,
  logo_url text,
  is_active boolean,
  price_ttl_hours int,
  offer_count int,
  product_count int,
  fresh_offers int,
  stale_offers int,
  connector_key text,
  sync_job_id uuid,
  sync_active boolean,
  last_run_at timestamptz,
  consecutive_failures int,
  affiliate_network text,
  affiliate_active boolean,
  clicks_30d bigint
)
language sql
stable
as $$
  select
    m.id, m.name, m.slug, m.logo_url, m.is_active, m.price_ttl_hours,
    coalesce(o.offer_count, 0),
    coalesce(o.product_count, 0),
    coalesce(o.fresh_offers, 0),
    coalesce(o.stale_offers, 0),
    sj.connector_key, sj.id, sj.is_active, sj.last_run_at,
    coalesce(sj.consecutive_failures, 0),
    ac.network, ac.is_active,
    coalesce(cl.clicks, 0)
  from public.merchants m
  left join lateral (
    select
      count(*)::int as offer_count,
      count(distinct pv.product_id)::int as product_count,
      count(*) filter (
        where public.price_freshness(pr.last_checked_at, m.price_ttl_hours) = 'fresh'
      )::int as fresh_offers,
      count(*) filter (
        where public.price_freshness(pr.last_checked_at, m.price_ttl_hours) <> 'fresh'
      )::int as stale_offers
    from public.merchant_offers mo
    join public.product_variants pv on pv.id = mo.product_variant_id
    left join public.prices pr on pr.merchant_offer_id = mo.id
    where mo.merchant_id = m.id and mo.is_active
  ) o on true
  left join lateral (
    select sj.id, sj.connector_key, sj.is_active, sj.last_run_at, sj.consecutive_failures
    from public.sync_jobs sj where sj.merchant_id = m.id
    order by sj.created_at asc limit 1
  ) sj on true
  left join lateral (
    select ac.network, ac.is_active
    from public.affiliate_configurations ac
    where ac.merchant_id = m.id and ac.is_active
    limit 1
  ) ac on true
  left join lateral (
    select count(*) as clicks
    from public.affiliate_clicks c
    join public.merchant_offers mo2 on mo2.id = c.merchant_offer_id
    where mo2.merchant_id = m.id and c.clicked_at > now() - interval '30 days'
  ) cl on true
  order by m.is_active desc, m.name asc;
$$;

-- ---------------------------------------------------------------------
-- get_admin_top_lists — top products and merchants by click volume
-- ---------------------------------------------------------------------
create or replace function public.get_admin_top_lists(
  p_since_days int default 30,
  p_limit int default 10
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'top_products', coalesce((
      select jsonb_agg(t) from (
        select p.id, p.title, p.slug, count(*)::int as clicks
        from public.affiliate_clicks ac
        join public.merchant_offers mo on mo.id = ac.merchant_offer_id
        join public.product_variants pv on pv.id = mo.product_variant_id
        join public.products p on p.id = pv.product_id
        where ac.clicked_at > now() - make_interval(days => p_since_days)
        group by p.id, p.title, p.slug
        order by count(*) desc limit p_limit
      ) t
    ), '[]'::jsonb),
    'top_merchants', coalesce((
      select jsonb_agg(t) from (
        select m.id, m.name, count(*)::int as clicks,
               count(*) filter (where ac.link_outcome = 'affiliate')::int as tracked
        from public.affiliate_clicks ac
        join public.merchant_offers mo on mo.id = ac.merchant_offer_id
        join public.merchants m on m.id = mo.merchant_id
        where ac.clicked_at > now() - make_interval(days => p_since_days)
        group by m.id, m.name
        order by count(*) desc limit p_limit
      ) t
    ), '[]'::jsonb)
  );
$$;
