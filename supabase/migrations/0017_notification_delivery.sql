-- 0017_notification_delivery.sql
--
-- Completes the alert system: delivery tracking with retry, push
-- subscription storage, and per-user unsubscribe salts.
--
-- Nothing here touches price logic. Alerts still fire only via
-- get_alert_candidates() -> lib/alerts/rules.ts, which is the single place
-- price validity and duplicate suppression are decided.

-- ---------------------------------------------------------------------
-- Unsubscribe salt
-- ---------------------------------------------------------------------
-- Unsubscribe tokens are stateless HMACs (lib/notifications/unsubscribe.ts).
-- This per-user salt is what makes revocation possible: rotating it
-- invalidates every link previously sent to that user, and only that user.
alter table public.profiles
  add column unsubscribe_salt uuid not null default gen_random_uuid();

comment on column public.profiles.unsubscribe_salt is
  'Mixed into the HMAC of unsubscribe links. Rotate to invalidate all '
  'previously issued links for this user. Never exposed to the client.';

-- ---------------------------------------------------------------------
-- notification_deliveries — one row per channel attempt
-- ---------------------------------------------------------------------
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email', 'push', 'in_app')),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'permanently_failed', 'suppressed')),
  attempts int not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  -- A short provider error code. NEVER the recipient address or the
  -- provider's raw response, which can echo back personal data.
  error_code text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  -- One attempt record per notification per channel: re-running the sender
  -- updates the existing row instead of creating duplicates.
  unique (notification_id, channel)
);

create index notification_deliveries_due_idx
  on public.notification_deliveries(next_attempt_at)
  where status = 'failed';
create index notification_deliveries_user_idx
  on public.notification_deliveries(user_id, created_at desc);

comment on column public.notification_deliveries.error_code is
  'Short machine-readable code only (hard_bounce, http_503, ...). Raw '
  'provider responses are deliberately not stored: they frequently echo '
  'the recipient address back, which would put personal data in an '
  'operational table.';

alter table public.notification_deliveries enable row level security;
-- Users may see whether their own notifications were delivered.
create policy notification_deliveries_select_own on public.notification_deliveries
  for select using (auth.uid() = user_id or public.is_admin());
-- No client write policy: only the service-role sender writes these.

-- ---------------------------------------------------------------------
-- push_subscriptions — Web Push endpoints
-- ---------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- The browser's push service endpoint. Unique so re-subscribing the same
  -- browser updates rather than duplicating.
  endpoint text not null unique,
  -- Public key material from the browser's PushSubscription. These are
  -- per-subscription public values, not account credentials.
  p256dh text not null,
  auth text not null,
  user_agent_family text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  failure_count int not null default 0 check (failure_count >= 0)
);

create index push_subscriptions_user_idx on public.push_subscriptions(user_id);

comment on table public.push_subscriptions is
  'Web Push endpoints. Sending requires VAPID keys — see '
  'lib/notifications/push.ts. Rows are removed when the push service '
  'reports the subscription gone (HTTP 404/410), which is the documented '
  'way to keep this table from filling with dead endpoints.';

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- get_pending_deliveries — the sender's work queue
-- ---------------------------------------------------------------------
create or replace function public.get_pending_deliveries(p_limit int default 100)
returns table (
  delivery_id uuid,
  notification_id uuid,
  user_id uuid,
  channel text,
  attempts int,
  next_attempt_at timestamptz,
  title text,
  body text,
  product_slug text,
  unsubscribe_salt uuid,
  notify_email boolean,
  notify_push boolean
)
language sql
stable
as $$
  select
    d.id, d.notification_id, d.user_id, d.channel, d.attempts, d.next_attempt_at,
    n.title, n.body, p.slug, pr.unsubscribe_salt, pr.notify_email, pr.notify_push
  from public.notification_deliveries d
  join public.notifications n on n.id = d.notification_id
  join public.profiles pr on pr.id = d.user_id
  left join public.products p on p.id = n.related_product_id
  where d.status = 'pending'
     or (d.status = 'failed' and (d.next_attempt_at is null or d.next_attempt_at <= now()))
  order by d.created_at asc
  limit p_limit;
$$;

comment on function public.get_pending_deliveries is
  'Deliveries awaiting a first attempt or due for retry. Email addresses '
  'are deliberately NOT returned here — the sender resolves them from '
  'auth.users at send time and never persists them alongside the queue.';

-- ---------------------------------------------------------------------
-- queue_notification_delivery — create the per-channel attempt rows
-- ---------------------------------------------------------------------
create or replace function public.queue_notification_delivery(
  p_notification_id uuid,
  p_channels text[]
)
returns int
language plpgsql
as $$
declare
  v_user_id uuid;
  v_channel text;
  v_count int := 0;
begin
  select user_id into v_user_id from public.notifications where id = p_notification_id;
  if v_user_id is null then
    raise exception 'Notification % not found', p_notification_id;
  end if;

  foreach v_channel in array p_channels loop
    insert into public.notification_deliveries (notification_id, user_id, channel, status)
    values (
      p_notification_id, v_user_id, v_channel,
      -- in_app needs no external delivery: the notification row IS the
      -- delivery, so it is recorded as already sent.
      case when v_channel = 'in_app' then 'sent' else 'pending' end
    )
    on conflict (notification_id, channel) do nothing;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- record_delivery_attempt — outcome from the sender
-- ---------------------------------------------------------------------
create or replace function public.record_delivery_attempt(
  p_delivery_id uuid,
  p_status text,
  p_error_code text default null,
  p_next_attempt_at timestamptz default null,
  p_provider_message_id text default null
)
returns void
language sql
as $$
  update public.notification_deliveries
  set status = p_status,
      attempts = attempts + 1,
      last_attempt_at = now(),
      next_attempt_at = p_next_attempt_at,
      error_code = p_error_code,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id)
  where id = p_delivery_id;
$$;

-- ---------------------------------------------------------------------
-- apply_unsubscribe — turn off a channel from a signed link
-- ---------------------------------------------------------------------
-- Called with the service role after the token's HMAC has been verified in
-- application code. Idempotent: following the link twice is harmless, which
-- matters because mail scanners follow links automatically.
create or replace function public.apply_unsubscribe(p_user_id uuid, p_channel text)
returns void
language sql
as $$
  update public.profiles
  set
    notify_price_drop = case when p_channel in ('price_drop', 'all') then false else notify_price_drop end,
    notify_back_in_stock = case when p_channel in ('back_in_stock', 'all') then false else notify_back_in_stock end,
    notify_product_news = case when p_channel in ('product_news', 'all') then false else notify_product_news end,
    -- "all" also stops email delivery entirely, since that is what a user
    -- clicking a global unsubscribe expects.
    notify_email = case when p_channel = 'all' then false else notify_email end,
    updated_at = now()
  where id = p_user_id;
$$;

-- ---------------------------------------------------------------------
-- Retention: delivery records are operational, not permanent
-- ---------------------------------------------------------------------
create or replace function public.prune_notification_deliveries(p_retain_days int default 90)
returns int
language plpgsql
as $$
declare v_deleted int;
begin
  delete from public.notification_deliveries
  where created_at < now() - make_interval(days => p_retain_days)
    and status in ('sent', 'permanently_failed', 'suppressed');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
