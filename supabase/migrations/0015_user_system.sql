-- 0015_user_system.sql
--
-- User account features. Two principles govern everything here:
--
--   1. MINIMAL DATA. We store what a feature genuinely needs and nothing
--      more. recently_viewed keeps a product id and a timestamp — no
--      dwell time, no scroll depth, no referrer chain — and prunes itself.
--
--   2. NO DUPLICATED PRICE LOGIC. Alert triggering asks the price engine
--      what the current valid price is via price_freshness(); it does not
--      re-derive "is this price usable". An alert must never fire on an
--      expired price.

-- ---------------------------------------------------------------------
-- Alert trigger state
-- ---------------------------------------------------------------------
alter table public.price_alerts
  -- The price at the last notification. Re-notifying requires the price to
  -- have fallen FURTHER, which is what stops a cron running every few
  -- hours from emailing the same drop repeatedly.
  add column last_triggered_price numeric(12,2),
  add column trigger_count int not null default 0 check (trigger_count >= 0);

comment on column public.price_alerts.last_triggered_price is
  'Price at the moment the alert last fired. Combined with '
  'last_triggered_at this prevents duplicate notifications for the same '
  'drop while still allowing a notification when the price falls further.';

-- ---------------------------------------------------------------------
-- Notification preferences (extends the existing profiles columns)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column notify_price_drop boolean not null default true,
  add column notify_back_in_stock boolean not null default false,
  -- Deliberately not a marketing consent by default: opt-in, not opt-out.
  add column notify_product_news boolean not null default false;

-- ---------------------------------------------------------------------
-- recently_viewed — deliberately minimal browsing history
-- ---------------------------------------------------------------------
create table public.recently_viewed (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  -- One row per user+product: re-viewing updates the timestamp rather than
  -- accumulating a visit log. We need "what did I look at", not "how often".
  primary key (user_id, product_id)
);

create index recently_viewed_user_time_idx on public.recently_viewed(user_id, viewed_at desc);

comment on table public.recently_viewed is
  'Minimal by design: product + timestamp only, one row per product, '
  'auto-pruned by prune_recently_viewed(). No dwell time, referrer, or '
  'session data — none of which the feature needs.';

alter table public.recently_viewed enable row level security;
create policy recently_viewed_select_own on public.recently_viewed
  for select using (auth.uid() = user_id);
create policy recently_viewed_insert_own on public.recently_viewed
  for insert with check (auth.uid() = user_id);
create policy recently_viewed_update_own on public.recently_viewed
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy recently_viewed_delete_own on public.recently_viewed
  for delete using (auth.uid() = user_id);

-- Keeps history short. A browsing trail is behavioural data; retaining it
-- indefinitely is a liability with no product benefit.
create or replace function public.prune_recently_viewed(
  p_keep_per_user int default 50,
  p_retain_days int default 90
)
returns int
language plpgsql
as $$
declare
  v_deleted int;
begin
  delete from public.recently_viewed rv
  where rv.viewed_at < now() - make_interval(days => p_retain_days)
     or rv.ctid in (
       select ctid from (
         select ctid, row_number() over (partition by user_id order by viewed_at desc) as rn
         from public.recently_viewed
       ) ranked
       where ranked.rn > p_keep_per_user
     );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------
-- audit_log — sensitive admin actions
-- ---------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_table text,
  target_id text,
  -- Redacted summary only. Never store request bodies wholesale: they can
  -- contain tokens, and a log is exactly the wrong place for those.
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_actor_idx on public.audit_log(actor_id, created_at desc);
create index audit_log_action_idx on public.audit_log(action, created_at desc);

alter table public.audit_log enable row level security;
create policy audit_log_admin_read on public.audit_log for select using (public.is_admin());
-- No write policy: entries are written by the service role only, so an
-- admin cannot edit or delete their own audit trail.

comment on table public.audit_log is
  'Append-only record of sensitive admin actions. No client role has an '
  'INSERT/UPDATE/DELETE policy — writes go through the service role — so '
  'an admin cannot tamper with their own trail.';

-- ---------------------------------------------------------------------
-- get_alert_candidates — asks the PRICE ENGINE for the current valid price
-- ---------------------------------------------------------------------
-- Returns every active alert alongside the cheapest CURRENTLY VALID price
-- for its product. Validity is decided by price_freshness() — the same
-- function the product page and search use — so an alert can never fire on
-- an expired price. The decision of whether to actually notify lives in
-- lib/alerts/rules.ts, where it is unit-testable.
create or replace function public.get_alert_candidates(p_limit int default 500)
returns table (
  alert_id uuid,
  user_id uuid,
  product_id uuid,
  product_title text,
  product_slug text,
  target_price numeric,
  current_price numeric,
  merchant_name text,
  last_triggered_at timestamptz,
  last_triggered_price numeric,
  notify_email boolean,
  notify_price_drop boolean,
  notify_push boolean
)
language sql
stable
as $$
  select
    a.id,
    a.user_id,
    a.product_id,
    p.title,
    p.slug,
    a.target_price,
    best.price,
    best.merchant_name,
    a.last_triggered_at,
    a.last_triggered_price,
    pr.notify_email,
    pr.notify_price_drop,
    pr.notify_push
  from public.price_alerts a
  join public.products p on p.id = a.product_id and p.is_active
  join public.profiles pr on pr.id = a.user_id
  -- Cheapest offer that is in stock AND not expired, scoped to the
  -- alert's variant when one was specified, otherwise the primary variant
  -- — matching get_product_pricing()'s definition exactly.
  left join lateral (
    select price.price, m.name as merchant_name
    from public.product_variants pv
    join public.merchant_offers mo on mo.product_variant_id = pv.id and mo.is_active
    join public.prices price on price.merchant_offer_id = mo.id
    join public.merchants m on m.id = mo.merchant_id and m.is_active
    where pv.product_id = a.product_id
      and pv.is_active
      and (a.product_variant_id is null or pv.id = a.product_variant_id)
      and price.in_stock
      and public.price_freshness(price.last_checked_at, m.price_ttl_hours) <> 'expired'
    order by
      -- Prefer the alert's variant, else the primary (earliest) variant.
      (a.product_variant_id is not null and pv.id = a.product_variant_id) desc,
      pv.created_at asc,
      price.price asc
    limit 1
  ) best on true
  where a.is_active
    and best.price is not null
    and best.price <= a.target_price
  order by a.last_triggered_at asc nulls first
  limit p_limit;
$$;

comment on function public.get_alert_candidates is
  'Alerts whose product currently has a VALID price at or below target. '
  'Validity comes from price_freshness() — this function deliberately '
  'does not re-implement any price rules. Whether to notify is decided by '
  'lib/alerts/rules.ts.';

-- ---------------------------------------------------------------------
-- record_alert_trigger — atomically mark fired + create the notification
-- ---------------------------------------------------------------------
create or replace function public.record_alert_trigger(
  p_alert_id uuid,
  p_price numeric,
  p_title text,
  p_body text,
  p_create_notification boolean default true
)
returns uuid
language plpgsql
as $$
declare
  v_user_id uuid;
  v_product_id uuid;
  v_notification_id uuid;
begin
  update public.price_alerts
  set last_triggered_at = now(),
      last_triggered_price = p_price,
      trigger_count = trigger_count + 1,
      updated_at = now()
  where id = p_alert_id
  returning user_id, product_id into v_user_id, v_product_id;

  if v_user_id is null then
    raise exception 'Alert % not found', p_alert_id;
  end if;

  -- The in-app notification is always created; the email is a separate
  -- delivery step gated on the user's preference, so turning email off
  -- doesn't silently lose the record that the alert fired.
  if p_create_notification then
    insert into public.notifications (user_id, type, title, body, related_product_id)
    values (v_user_id, 'alert_triggered', p_title, p_body, v_product_id)
    returning id into v_notification_id;
  end if;

  return v_notification_id;
end;
$$;
