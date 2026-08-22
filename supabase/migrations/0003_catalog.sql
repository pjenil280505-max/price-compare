-- 0003_catalog.sql
-- Reference/catalog tables that products and offers hang off of.

-- ---------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger brands_set_updated_at
  before update on public.brands
  for each row execute function public.set_updated_at();

create index brands_name_trgm_idx on public.brands using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------
-- categories (self-referencing tree)
-- ---------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_id uuid references public.categories(id) on delete set null,
  image_url text,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_no_self_parent check (id <> parent_id)
);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create index categories_parent_id_idx on public.categories(parent_id);

comment on constraint categories_no_self_parent on public.categories is
  'Blocks the trivial self-reference cycle only. A category cannot be its '
  'own grandparent either, but a plain FK/CHECK cannot express that — the '
  'admin taxonomy editor must validate deeper cycles at the application '
  'layer before writing a reparent operation.';

-- ---------------------------------------------------------------------
-- merchants
-- ---------------------------------------------------------------------
create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  website_url text,
  trust_rating numeric(2,1) check (trust_rating is null or trust_rating between 0 and 5),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger merchants_set_updated_at
  before update on public.merchants
  for each row execute function public.set_updated_at();

create index merchants_is_active_idx on public.merchants(is_active) where is_active;

-- ---------------------------------------------------------------------
-- affiliate_configurations
-- ---------------------------------------------------------------------
-- Non-secret configuration only. Real API keys/tokens live in server-only
-- environment variables (see .env.local.example); env_var_prefix just
-- tells connector code which env vars to look up for this merchant at
-- runtime. Never add a "credentials" or "api_key" column to this table —
-- anything added here is readable by every admin via the dashboard.
create table public.affiliate_configurations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  network text not null check (network in (
    'direct', 'flipkart_affiliate', 'amazon_creators', 'admitad', 'cuelinks'
  )),
  base_url_template text,
  tracking_param text,
  env_var_prefix text,
  commission_rate numeric(5,2) check (commission_rate is null or commission_rate >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, network)
);

create trigger affiliate_configurations_set_updated_at
  before update on public.affiliate_configurations
  for each row execute function public.set_updated_at();

create index affiliate_configurations_merchant_id_idx on public.affiliate_configurations(merchant_id);
