-- 0013_affiliate_system.sql
--
-- Affiliate configuration lives at MERCHANT/NETWORK level. There is no
-- per-product link anywhere in this schema — a link is always derived at
-- click time from (merchant config + the destination URL the feed gave us).
--
-- Credentials are NOT stored here. affiliate_configurations holds only
-- non-secret shape: which strategy, which parameter names, which domains
-- are permitted. The tracking ID value itself is read from a server-only
-- environment variable named by env_var_prefix.

-- ---------------------------------------------------------------------
-- affiliate_configurations — strategy + permissions
-- ---------------------------------------------------------------------
alter table public.affiliate_configurations
  add column link_strategy text not null default 'passthrough'
    check (link_strategy in ('passthrough', 'deep_link_template', 'query_param')),
  -- Domains this configuration may deep-link to. Empty/null = unrestricted,
  -- which is only correct when the network's own terms say so.
  add column allowed_deep_link_domains text[] not null default '{}',
  add column sub_id_param text,
  add column campaign_param text,
  add column max_sub_id_length int default 64 check (max_sub_id_length is null or max_sub_id_length between 8 and 255),
  add column requires_encoded_destination boolean not null default true,
  -- Name of the env var holding the tracking ID, e.g. FLIPKART_AFFILIATE_ID.
  -- The VALUE never touches the database.
  add column tracking_id_env_var text;

comment on column public.affiliate_configurations.tracking_id_env_var is
  'NAME of the environment variable holding this network''s tracking ID — '
  'never the value. affiliate_configurations is readable by every admin '
  'and by the admin API, so a credential stored here would be exposed. '
  'See docs/SECURITY.md.';

comment on column public.affiliate_configurations.allowed_deep_link_domains is
  'Destinations outside this list are NOT wrapped in an affiliate link — '
  'the redirect falls back to the plain merchant URL. Wrapping a domain '
  'the network has not approved would breach their terms.';

comment on column public.affiliate_configurations.link_strategy is
  'passthrough        = feed URLs already carry the tag (Flipkart). '
  'query_param        = append the network''s documented tracking param. '
  'deep_link_template = wrap in the network''s documented template. '
  'No strategy fabricates a URL; all derive from configuration.';

-- ---------------------------------------------------------------------
-- affiliate_clicks — privacy-conscious redesign
-- ---------------------------------------------------------------------
-- The original table stored the full User-Agent string, which is a strong
-- browser fingerprint and far more than analytics needs. It is replaced
-- with coarse device/platform buckets. IPs were never stored and still
-- aren't.
alter table public.affiliate_clicks
  drop column if exists user_agent;

alter table public.affiliate_clicks
  add column device_type text check (device_type in ('mobile', 'tablet', 'desktop', 'bot', 'unknown')),
  add column platform text check (platform in ('android', 'ios', 'windows', 'macos', 'linux', 'other', 'unknown')),
  -- Which link strategy produced this click's destination, and whether it
  -- was actually tracked. Untracked clicks are the metric that tells you a
  -- feed stopped tagging its URLs.
  add column link_outcome text check (link_outcome in ('affiliate', 'fallback_untracked')),
  add column link_strategy text,
  add column fallback_reason text,
  add column sub_id text,
  add column campaign text;

comment on column public.affiliate_clicks.session_id is
  'Opaque rotating token from an httpOnly cookie. Not tied to an account, '
  'not derived from IP or User-Agent, and not usable to identify a person '
  'across sessions. Enough to deduplicate a single browsing session.';

comment on column public.affiliate_clicks.link_outcome is
  'fallback_untracked means the click earned no commission. A rising rate '
  'here is the earliest signal that a merchant feed or network config has '
  'broken — see get_affiliate_link_health().';

create index affiliate_clicks_outcome_idx on public.affiliate_clicks(link_outcome, clicked_at desc);

-- ---------------------------------------------------------------------
-- Analytics
-- ---------------------------------------------------------------------
create or replace function public.get_affiliate_click_stats(
  p_since_days int default 30
)
returns table (
  merchant_id uuid,
  merchant_name text,
  total_clicks bigint,
  affiliate_clicks bigint,
  untracked_clicks bigint,
  tracked_rate numeric,
  unique_sessions bigint,
  mobile_clicks bigint,
  desktop_clicks bigint
)
language sql
stable
as $$
  select
    m.id,
    m.name,
    count(*)::bigint as total_clicks,
    count(*) filter (where ac.link_outcome = 'affiliate')::bigint,
    count(*) filter (where ac.link_outcome = 'fallback_untracked')::bigint,
    case when count(*) > 0
      then round(100.0 * count(*) filter (where ac.link_outcome = 'affiliate') / count(*), 1)
      else null end,
    count(distinct ac.session_id)::bigint,
    count(*) filter (where ac.device_type = 'mobile')::bigint,
    count(*) filter (where ac.device_type = 'desktop')::bigint
  from public.affiliate_clicks ac
  join public.merchant_offers mo on mo.id = ac.merchant_offer_id
  join public.merchants m on m.id = mo.merchant_id
  where ac.clicked_at > now() - make_interval(days => p_since_days)
  group by m.id, m.name
  order by count(*) desc;
$$;

-- Surfaces broken affiliate configuration before it costs a month of
-- commission. A merchant whose tracked_rate drops is the actionable signal.
create or replace function public.get_affiliate_link_health(
  p_since_days int default 7
)
returns table (
  merchant_name text,
  fallback_reason text,
  occurrences bigint,
  last_seen timestamptz
)
language sql
stable
as $$
  select
    m.name,
    coalesce(ac.fallback_reason, 'unknown'),
    count(*)::bigint,
    max(ac.clicked_at)
  from public.affiliate_clicks ac
  join public.merchant_offers mo on mo.id = ac.merchant_offer_id
  join public.merchants m on m.id = mo.merchant_id
  where ac.clicked_at > now() - make_interval(days => p_since_days)
    and ac.link_outcome = 'fallback_untracked'
  group by m.name, ac.fallback_reason
  order by count(*) desc;
$$;

create or replace function public.get_top_clicked_products(
  p_since_days int default 30,
  p_limit int default 25
)
returns table (
  product_id uuid,
  product_title text,
  product_slug text,
  clicks bigint,
  unique_sessions bigint
)
language sql
stable
as $$
  select
    p.id,
    p.title,
    p.slug,
    count(*)::bigint,
    count(distinct ac.session_id)::bigint
  from public.affiliate_clicks ac
  join public.merchant_offers mo on mo.id = ac.merchant_offer_id
  join public.product_variants pv on pv.id = mo.product_variant_id
  join public.products p on p.id = pv.product_id
  where ac.clicked_at > now() - make_interval(days => p_since_days)
  group by p.id, p.title, p.slug
  order by count(*) desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------
-- Retention: click logs are behavioural data and shouldn't be kept
-- forever. Aggregates above stay useful; raw rows age out.
-- ---------------------------------------------------------------------
create or replace function public.prune_affiliate_clicks(p_retain_days int default 180)
returns int
language plpgsql
as $$
declare
  v_deleted int;
begin
  delete from public.affiliate_clicks
  where clicked_at < now() - make_interval(days => p_retain_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.prune_affiliate_clicks is
  'Deletes raw click rows past the retention window. Run alongside the '
  'price-history rollup. Keeping behavioural data indefinitely is both a '
  'storage cost and a data-protection liability under the DPDP Act.';
