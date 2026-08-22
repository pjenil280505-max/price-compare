-- 0010_connectors.sql
-- Connector infrastructure: per-job configuration and cursors, failed-record
-- capture, and the single atomic function that writes an ingested product
-- into the catalog.

-- ---------------------------------------------------------------------
-- sync_jobs additions
-- ---------------------------------------------------------------------
-- connector_key selects which registered connector implementation runs
-- (see lib/connectors/registry.ts). Adding a merchant later = insert a row
-- here with a new connector_key + config. No core schema change.
alter table public.sync_jobs
  add column connector_key text not null default 'unknown',
  add column config jsonb not null default '{}'::jsonb,
  add column consecutive_failures int not null default 0,
  add column schedule_interval_minutes int not null default 360
    check (schedule_interval_minutes >= 5);

comment on column public.sync_jobs.schedule_interval_minutes is
  'How long after a run finishes before the job is due again. Used instead '
  'of parsing the existing schedule_cron string: the scheduler is a single '
  'periodic trigger that asks "what is due now", so a plain interval is '
  'sufficient and avoids shipping a cron parser. Default 6 hours — raise '
  'the frequency for price deltas, lower it for full catalog sweeps.';

comment on column public.sync_jobs.config is
  'Non-secret connector configuration only: category allow-lists, feed '
  'URLs, page sizes, field mappings. Credentials NEVER go here — they are '
  'read from environment variables named by affiliate_configurations.'
  'env_var_prefix. See docs/CONNECTORS.md.';

comment on column public.sync_jobs.consecutive_failures is
  'Incremented on each failed run, reset to 0 on success. The scheduler '
  'uses this to back off a persistently-broken connector instead of '
  'hammering a merchant API that is rejecting us.';

-- ---------------------------------------------------------------------
-- connector_state — resumable cursors, one row per sync job
-- ---------------------------------------------------------------------
-- Kept separate from sync_jobs because it is written on every run (often
-- mid-run) while sync_jobs is configuration that changes rarely.
create table public.connector_state (
  sync_job_id uuid primary key references public.sync_jobs(id) on delete cascade,
  -- Opaque to the core system; each connector defines its own shape.
  -- Flipkart stores {"categoryVersions": {"reh": 136625296}}; a generic
  -- feed connector stores {"lastModified": "..."} or {"etag": "..."}.
  cursor jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create trigger connector_state_set_updated_at
  before update on public.connector_state
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- sync_failures — per-record failures, so one bad item never kills a run
-- ---------------------------------------------------------------------
create table public.sync_failures (
  id bigint generated always as identity primary key,
  sync_log_id uuid not null references public.sync_logs(id) on delete cascade,
  external_product_id text,
  stage text not null check (stage in ('fetch', 'parse', 'validate', 'persist')),
  reason text not null,
  -- The raw item that failed, for debugging. Capped by the application
  -- layer before insert (see lib/server/sync/engine.ts) so a pathological
  -- feed row can't bloat the table.
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index sync_failures_log_id_idx on public.sync_failures(sync_log_id, created_at desc);
create index sync_failures_stage_idx on public.sync_failures(stage);

-- ---------------------------------------------------------------------
-- RLS — admin-read only; all writes are service-role (ingestion)
-- ---------------------------------------------------------------------
alter table public.connector_state enable row level security;
create policy connector_state_admin_read on public.connector_state for select using (public.is_admin());

alter table public.sync_failures enable row level security;
create policy sync_failures_admin_read on public.sync_failures for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- slugify helper
-- ---------------------------------------------------------------------
create or replace function public.slugify(value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

-- ---------------------------------------------------------------------
-- ingest_normalized_product — the ONE write path into the catalog
-- ---------------------------------------------------------------------
-- Everything a connector produces goes through here. Doing it as a single
-- function (rather than a sequence of calls from TypeScript) means one
-- product is written atomically, ~1 round trip instead of ~8, and the
-- upsert-vs-insert decision lives next to the constraints that enforce it.
--
-- Matching order, highest confidence first (mirrors the matching
-- architecture in the platform doc):
--   1. Existing offer for (merchant_id, external_id) -> reuse its variant.
--   2. GTIN match against an existing product -> attach as a new offer.
--   3. Otherwise create a new product + variant.
-- Steps 2/3 are exact-identifier matching only. Fuzzy/embedding matching
-- runs as a separate later pass and is NOT performed here.
create or replace function public.ingest_normalized_product(
  p_merchant_id uuid,
  p_external_id text,
  p_title text,
  p_product_url text,
  p_price numeric,
  p_currency text default 'INR',
  p_mrp numeric default null,
  p_in_stock boolean default true,
  p_cod_available boolean default false,
  p_brand_name text default null,
  p_category_name text default null,
  p_description text default null,
  p_image_urls text[] default '{}',
  p_gtin text default null,
  p_model text default null,
  p_variant_label text default null,
  p_variant_attributes jsonb default '{}'::jsonb,
  p_specs jsonb default '{}'::jsonb,
  p_rating numeric default null,
  p_review_count int default null
)
returns table (product_id uuid, offer_id uuid, was_created boolean)
language plpgsql
as $$
declare
  v_brand_id uuid;
  v_category_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_offer_id uuid;
  v_created boolean := false;
  v_slug text;
  v_variant_label text;
  v_prev_price numeric;
  v_prev_stock boolean;
  v_specs jsonb;
begin
  if p_external_id is null or length(trim(p_external_id)) = 0 then
    raise exception 'external_id is required';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'title is required';
  end if;

  -- Fold the model number into specs. There is no dedicated products.model
  -- column, and specs is what the product page's Details tab renders — so
  -- this is where a model number is actually visible to a user, rather
  -- than being silently discarded.
  v_specs := coalesce(p_specs, '{}'::jsonb);
  if p_model is not null and length(trim(p_model)) > 0 then
    v_specs := v_specs || jsonb_build_object('Model', trim(p_model));
  end if;

  -- Brand: get-or-create by slug (names vary in casing/spacing across feeds).
  if p_brand_name is not null and length(trim(p_brand_name)) > 0 then
    insert into public.brands (name, slug)
    values (trim(p_brand_name), public.slugify(p_brand_name))
    on conflict (slug) do update set name = excluded.name
    returning id into v_brand_id;
  end if;

  -- Category: get-or-create by slug (leaf name only; the admin curates the
  -- taxonomy tree afterwards — that's structural, not product data).
  if p_category_name is not null and length(trim(p_category_name)) > 0 then
    insert into public.categories (name, slug)
    values (trim(p_category_name), public.slugify(p_category_name))
    on conflict (slug) do update set name = excluded.name
    returning id into v_category_id;
  end if;

  -- 1. Does this exact listing already exist?
  select mo.id, mo.product_variant_id
    into v_offer_id, v_variant_id
  from public.merchant_offers mo
  where mo.merchant_id = p_merchant_id and mo.external_product_id = p_external_id;

  if v_variant_id is not null then
    select pv.product_id into v_product_id
    from public.product_variants pv where pv.id = v_variant_id;
  end if;

  -- 2. No existing offer: try to attach to an existing product by GTIN.
  if v_product_id is null and p_gtin is not null and length(trim(p_gtin)) > 0 then
    select p.id into v_product_id from public.products p where p.gtin = trim(p_gtin);
  end if;

  -- 3. Still nothing: create the product.
  if v_product_id is null then
    -- Slug must be unique. Suffixing with the merchant's external id keeps
    -- it deterministic (re-running ingestion produces the same slug) while
    -- avoiding collisions between same-titled products from different
    -- merchants.
    v_slug := left(public.slugify(p_title), 80) || '-' || lower(left(p_external_id, 12));

    insert into public.products (
      slug, title, brand_id, category_id, description, specs,
      primary_image_url, images, gtin
    )
    values (
      v_slug, trim(p_title), v_brand_id, v_category_id, p_description,
      v_specs,
      coalesce(p_image_urls[1], ''), coalesce(p_image_urls, '{}'),
      nullif(trim(coalesce(p_gtin, '')), '')
    )
    on conflict (slug) do update set
      title = excluded.title,
      description = coalesce(excluded.description, public.products.description),
      updated_at = now()
    returning id into v_product_id;

    v_created := true;
  else
    -- Known product: refresh the descriptive fields that can drift.
    update public.products set
      description = coalesce(p_description, description),
      specs = case when v_specs = '{}'::jsonb then specs else v_specs end,
      brand_id = coalesce(v_brand_id, brand_id),
      category_id = coalesce(v_category_id, category_id),
      updated_at = now()
    where id = v_product_id;
  end if;

  -- Variant. A feed that gives us no variant axis still needs exactly one
  -- variant row to hang offers off of — "Standard" is that default.
  if v_variant_id is null then
    v_variant_label := coalesce(nullif(trim(coalesce(p_variant_label, '')), ''), 'Standard');

    insert into public.product_variants (product_id, label, attributes)
    values (v_product_id, v_variant_label, coalesce(p_variant_attributes, '{}'::jsonb))
    on conflict (product_id, label) do update set
      attributes = excluded.attributes,
      updated_at = now()
    returning id into v_variant_id;
  end if;

  -- Offer. Unique on (merchant_id, external_product_id), so re-ingesting
  -- the same feed item updates in place — this is what makes every sync
  -- run idempotent.
  insert into public.merchant_offers (
    product_variant_id, merchant_id, external_product_id, destination_url, is_active
  )
  values (v_variant_id, p_merchant_id, p_external_id, p_product_url, true)
  on conflict (merchant_id, external_product_id) do update set
    destination_url = excluded.destination_url,
    product_variant_id = excluded.product_variant_id,
    is_active = true,
    updated_at = now()
  returning id into v_offer_id;

  -- Current price (1:1 with the offer).
  select pr.price, pr.in_stock into v_prev_price, v_prev_stock
  from public.prices pr where pr.merchant_offer_id = v_offer_id;

  insert into public.prices (
    merchant_offer_id, price, mrp, currency, in_stock, cod_available,
    rating, review_count, last_checked_at
  )
  values (
    v_offer_id, p_price, p_mrp, coalesce(p_currency, 'INR'), p_in_stock,
    coalesce(p_cod_available, false), p_rating, p_review_count, now()
  )
  on conflict (merchant_offer_id) do update set
    price = excluded.price,
    mrp = excluded.mrp,
    in_stock = excluded.in_stock,
    cod_available = excluded.cod_available,
    rating = coalesce(excluded.rating, public.prices.rating),
    review_count = coalesce(excluded.review_count, public.prices.review_count),
    last_checked_at = now(),
    updated_at = now();

  -- History: only append when something actually changed. Writing a row on
  -- every check would multiply this table's growth by the sync frequency
  -- for no added information.
  if v_prev_price is null or v_prev_price <> p_price or v_prev_stock is distinct from p_in_stock then
    insert into public.price_history (merchant_offer_id, price, mrp, in_stock)
    values (v_offer_id, p_price, p_mrp, p_in_stock);
  end if;

  return query select v_product_id, v_offer_id, v_created;
end;
$$;

comment on function public.ingest_normalized_product is
  'The single write path into the catalog. Called only by the sync engine '
  'via the service-role client — RLS grants no client, including admins, '
  'write access to products/offers/prices, which is what structurally '
  'enforces the "no manual product entry" requirement.';

-- ---------------------------------------------------------------------
-- deactivate_missing_offers — soft-delete listings a full sync no longer saw
-- ---------------------------------------------------------------------
create or replace function public.deactivate_missing_offers(
  p_merchant_id uuid,
  p_before timestamptz
)
returns int
language sql
as $$
  with deactivated as (
    update public.merchant_offers mo
    set is_active = false, updated_at = now()
    where mo.merchant_id = p_merchant_id
      and mo.is_active
      -- Every ingest_normalized_product() upsert bumps updated_at, so any
      -- offer the run actually saw has updated_at >= p_before. Anything
      -- older was not in this feed. Deliberately NOT taking a list of seen
      -- IDs: that would mean holding the entire catalog's external IDs in
      -- memory and shipping them in one RPC payload, for no added
      -- correctness.
      and mo.updated_at < p_before
    returning 1
  )
  select count(*)::int from deactivated;
$$;

comment on function public.deactivate_missing_offers is
  'Soft-deletes (is_active=false) rather than hard-deleting, so '
  'price_history and affiliate_clicks referencing an offer survive a '
  'product being delisted. Only safe to call after a FULL catalog sync — '
  'calling it after a delta sync would deactivate everything the delta '
  'did not happen to include.';
