-- 0004_products.sql
-- Canonical products (the "same phone" regardless of which store sells it)
-- and their variants (storage/color/size). Merchant-specific listings and
-- prices live in 0005 — a product/variant can exist with zero offers.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  brand_id uuid references public.brands(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  description text,
  specs jsonb not null default '{}'::jsonb,
  primary_image_url text,
  images text[] not null default '{}',
  -- GTIN/EAN/UPC when a feed provides one — the highest-confidence signal
  -- for product matching (see product_match_reviews in 0007). Coverage is
  -- inconsistent for Indian catalogs, especially fashion, hence nullable.
  gtin text,
  -- pgvector embedding of title+brand+category+attributes, populated by the
  -- matching pipeline. Powers both matching and the "alternatives" feature.
  embedding vector(1536),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- Duplicate prevention: two feed items with the same GTIN are the same
-- product. Partial (where gtin is not null) since most rows won't have one.
create unique index products_gtin_key on public.products(gtin) where gtin is not null;

-- Full-text search (primary search path) and trigram (typo-tolerant
-- fallback / autocomplete) — see docs/DATABASE.md "efficient search".
create index products_search_vector_idx on public.products using gin(search_vector);
create index products_title_trgm_idx on public.products using gin (title gin_trgm_ops);

create index products_brand_id_idx on public.products(brand_id);
create index products_category_id_idx on public.products(category_id) where is_active;
create index products_is_active_idx on public.products(is_active) where is_active;

-- Approximate nearest-neighbor index for embedding similarity search
-- (alternatives, matching). Built with a modest `lists` value suitable for
-- a catalog in the thousands-to-low-millions range; re-tune (roughly
-- sqrt(row count)) once real catalog size is known — see docs/DATABASE.md.
create index products_embedding_idx on public.products
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

comment on column public.products.embedding is
  'Populated by the matching pipeline (architecture doc, section 6), not '
  'by this web app. Nullable until backfilled — every query against it '
  'must handle NULL (a product simply has no ANN-similar alternatives yet).';

-- ---------------------------------------------------------------------
-- product_variants
-- ---------------------------------------------------------------------
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  label text not null,
  attributes jsonb not null default '{}'::jsonb,
  sku_hint text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, label)
);

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

create index product_variants_product_id_idx on public.product_variants(product_id);
create index product_variants_attributes_idx on public.product_variants using gin (attributes);
