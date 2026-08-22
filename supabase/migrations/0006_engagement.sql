-- 0006_engagement.sql
-- Everything a signed-in user owns directly. RLS (0008) restricts every
-- one of these tables to "your own rows only."

create table public.wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index wishlists_user_id_idx on public.wishlists(user_id, created_at desc);
create index wishlists_product_id_idx on public.wishlists(product_id);

-- ---------------------------------------------------------------------
-- price_alerts
-- ---------------------------------------------------------------------
create table public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  product_variant_id uuid references public.product_variants(id) on delete cascade,
  target_price numeric(12,2) not null check (target_price > 0),
  is_active boolean not null default true,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger price_alerts_set_updated_at
  before update on public.price_alerts
  for each row execute function public.set_updated_at();

-- Duplicate prevention that actually works with a nullable variant_id:
-- plain UNIQUE(user_id, product_id, product_variant_id) would let a user
-- create unlimited duplicate alerts with variant_id left NULL, since
-- Postgres treats NULLs as distinct in unique constraints. Coalescing to a
-- sentinel UUID makes "no variant specified" a single, deduplicated value.
create unique index price_alerts_unique_target_idx on public.price_alerts (
  user_id, product_id, coalesce(product_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create index price_alerts_user_id_idx on public.price_alerts(user_id);
create index price_alerts_active_idx on public.price_alerts(product_id) where is_active;

-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('price_drop', 'back_in_stock', 'alert_triggered', 'system')),
  title text not null,
  body text,
  related_product_id uuid references public.products(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- The one query this table exists to serve: "my unread notifications,
-- newest first" — a composite index matching that exact access pattern.
create index notifications_user_unread_idx on public.notifications(user_id, is_read, created_at desc);
