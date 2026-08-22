-- 0011_matching.sql
-- Product matching across merchants.
--
-- The core safety property is enforced by a UNIQUE INDEX, not by
-- application logic: product_variants is unique on
-- (product_id, variant_signature). Two items whose extracted signatures
-- differ physically cannot occupy the same variant row, regardless of how
-- confident the matcher was. See lib/matching/variant.ts.

-- ---------------------------------------------------------------------
-- Matching columns
-- ---------------------------------------------------------------------
alter table public.products
  add column mpn text,
  add column model text,
  -- Title with brand, marketing noise, and ALL variant tokens removed.
  -- This is product identity; the variant axes live on product_variants.
  add column product_key text,
  add column match_tier text,
  add column match_confidence numeric(4,3)
    check (match_confidence is null or match_confidence between 0 and 1);

comment on column public.products.product_key is
  'Normalized title EXCLUDING variant tokens — "iPhone 15 256GB Black" and '
  '"iPhone 15 512GB Blue" share this key. Computed by '
  'lib/matching/normalize.ts:buildProductKey and written by ingestion; '
  'never edited by hand.';

alter table public.product_variants
  -- Canonical "axis=value|axis=value", axes sorted. Empty string = the
  -- single unadorned variant of a product with no variant axes.
  add column variant_signature text not null default '',
  add column variant_axes jsonb not null default '{}'::jsonb;

comment on column public.product_variants.variant_signature is
  'THE variant safety key. Unique per product — see '
  'product_variants_signature_key below. A 256GB item and a 512GB item '
  'produce different signatures and therefore cannot share a variant row.';

-- Seed signatures for rows that existed BEFORE this migration. Without
-- this, every pre-existing variant would carry the default empty
-- signature, and creating the unique index below would fail outright on
-- any product that already has more than one variant. `label` is already
-- unique per product (0004), so deriving from it is guaranteed collision-
-- free. The "legacy:" prefix marks rows whose axes were never extracted,
-- so a later backfill pass can find and re-derive them.
update public.product_variants
set variant_signature = 'legacy:' || public.slugify(label)
where coalesce(variant_signature, '') = ''
  and exists (
    select 1 from public.product_variants sibling
    where sibling.product_id = product_variants.product_id
      and sibling.id <> product_variants.id
  );

-- The structural guarantee.
create unique index product_variants_signature_key
  on public.product_variants(product_id, variant_signature);

create index products_mpn_idx on public.products(mpn) where mpn is not null;
create index products_model_idx on public.products(model) where model is not null;
create index products_product_key_idx on public.products(product_key) where product_key is not null;
-- Trigram index backing the controlled-fuzzy tier.
create index products_product_key_trgm_idx on public.products using gin (product_key gin_trgm_ops);
create index product_variants_axes_idx on public.product_variants using gin (variant_axes);

-- ---------------------------------------------------------------------
-- Merge audit log
-- ---------------------------------------------------------------------
-- Records every merge and unmerge with enough detail to reverse it. The
-- snapshot is what makes unmerge possible at all: once offers are moved,
-- the original grouping is otherwise unrecoverable.
create table public.product_merge_log (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('merge', 'unmerge', 'auto_merge')),
  -- The product that survived (merge) or was split from (unmerge).
  primary_product_id uuid references public.products(id) on delete set null,
  -- The product that was absorbed (merge) or created (unmerge).
  secondary_product_id uuid references public.products(id) on delete set null,
  match_tier text,
  confidence numeric(4,3),
  -- Offer ids and their prior variant ids, so unmerge can restore exactly.
  snapshot jsonb not null default '{}'::jsonb,
  performed_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index product_merge_log_primary_idx on public.product_merge_log(primary_product_id, created_at desc);
create index product_merge_log_action_idx on public.product_merge_log(action, created_at desc);

alter table public.product_merge_log enable row level security;
create policy product_merge_log_admin_read on public.product_merge_log for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- product_match_reviews additions
-- ---------------------------------------------------------------------
alter table public.product_match_reviews
  add column match_tier text,
  add column proposed_variant_signature text,
  -- Extracted axes for both sides, so the admin UI can show exactly WHY
  -- something was flagged without re-running the matcher.
  add column subject_snapshot jsonb not null default '{}'::jsonb,
  add column conflicts jsonb not null default '[]'::jsonb,
  add column reasons text[] not null default '{}';

-- ---------------------------------------------------------------------
-- find_match_candidates — indexed candidate retrieval
-- ---------------------------------------------------------------------
-- Returns a SMALL candidate set for the TypeScript matcher to score. All
-- scoring, tier selection, and the variant gate live in TypeScript
-- (lib/matching/matcher.ts) where they're unit-testable; SQL's job is only
-- to narrow millions of rows to a handful using indexes.
create or replace function public.find_match_candidates(
  p_gtin text default null,
  p_mpn text default null,
  p_model text default null,
  p_brand_name text default null,
  p_product_key text default null,
  p_limit int default 10
)
returns table (
  product_id uuid,
  title text,
  brand_name text,
  model text,
  mpn text,
  gtin text,
  product_key text,
  variants jsonb
)
language sql
stable
as $$
  with candidates as (
    -- Exact identifier hits first; these are cheap and highly selective.
    select p.id, 1 as rank_order
    from public.products p
    where p_gtin is not null and p.gtin = p_gtin
    union
    select p.id, 2
    from public.products p
    where p_mpn is not null and p.mpn = p_mpn
    union
    select p.id, 3
    from public.products p
    where p_model is not null and p.model = p_model
    union
    select p.id, 4
    from public.products p
    where p_product_key is not null and p.product_key = p_product_key
    union
    -- Controlled fuzzy: trigram similarity, but ONLY within the same
    -- brand. Without the brand restriction this returns hundreds of
    -- unrelated products for generic titles.
    select p.id, 5
    from public.products p
    left join public.brands b on b.id = p.brand_id
    where p_product_key is not null
      and p_brand_name is not null
      and b.slug = public.slugify(p_brand_name)
      and p.product_key % p_product_key
    limit 50
  ),
  ranked as (
    select c.id, min(c.rank_order) as rank_order
    from candidates c
    group by c.id
    order by min(c.rank_order)
    limit p_limit
  )
  select
    p.id,
    p.title,
    b.name as brand_name,
    p.model,
    p.mpn,
    p.gtin,
    p.product_key,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', pv.id,
          'signature', pv.variant_signature,
          'axes', pv.variant_axes
        ))
        from public.product_variants pv
        where pv.product_id = p.id and pv.is_active
      ),
      '[]'::jsonb
    ) as variants
  from ranked r
  join public.products p on p.id = r.id
  left join public.brands b on b.id = p.brand_id
  where p.is_active
  order by r.rank_order;
$$;

comment on function public.find_match_candidates is
  'Narrows the catalog to a handful of plausible products using indexes. '
  'Deliberately does NOT decide anything — scoring, tier priority, and the '
  'variant-conflict gate are in lib/matching/matcher.ts so they can be '
  'unit-tested without a database.';

-- ---------------------------------------------------------------------
-- merge_products — fold one product into another, reversibly
-- ---------------------------------------------------------------------
create or replace function public.merge_products(
  p_primary_product_id uuid,
  p_secondary_product_id uuid,
  p_performed_by uuid default null,
  p_reason text default null,
  p_action text default 'merge'
)
returns uuid
language plpgsql
as $$
declare
  v_log_id uuid;
  v_snapshot jsonb;
  v_variant record;
  v_target_variant_id uuid;
begin
  if p_primary_product_id = p_secondary_product_id then
    raise exception 'Cannot merge a product into itself';
  end if;

  -- Snapshot BEFORE mutating: records which offers belonged to which
  -- variant of the secondary product, which is the only way unmerge can
  -- restore the original structure.
  select jsonb_build_object(
    'secondary_product', to_jsonb(sp) - 'embedding' - 'search_vector',
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'variant_id', pv.id,
        'label', pv.label,
        'signature', pv.variant_signature,
        'axes', pv.variant_axes,
        'offer_ids', coalesce((
          select jsonb_agg(mo.id) from public.merchant_offers mo
          where mo.product_variant_id = pv.id
        ), '[]'::jsonb)
      ))
      from public.product_variants pv where pv.product_id = p_secondary_product_id
    ), '[]'::jsonb)
  )
  into v_snapshot
  from public.products sp
  where sp.id = p_secondary_product_id;

  if v_snapshot is null then
    raise exception 'Secondary product % not found', p_secondary_product_id;
  end if;

  -- Move each secondary variant's offers onto the primary product's
  -- variant WITH THE SAME SIGNATURE, creating it if absent. Offers are
  -- never moved to a variant with a different signature — that is the
  -- merge-time expression of the never-merge-different-variants rule.
  for v_variant in
    select id, label, variant_signature, variant_axes
    from public.product_variants
    where product_id = p_secondary_product_id
  loop
    select id into v_target_variant_id
    from public.product_variants
    where product_id = p_primary_product_id
      and variant_signature = v_variant.variant_signature;

    if v_target_variant_id is null then
      insert into public.product_variants (product_id, label, variant_signature, variant_axes, attributes)
      values (p_primary_product_id, v_variant.label, v_variant.variant_signature, v_variant.variant_axes, '{}'::jsonb)
      returning id into v_target_variant_id;
    end if;

    update public.merchant_offers
    set product_variant_id = v_target_variant_id, updated_at = now()
    where product_variant_id = v_variant.id;
  end loop;

  -- Re-point user-facing references so wishlists and alerts survive.
  update public.wishlists set product_id = p_primary_product_id
  where product_id = p_secondary_product_id
    -- Skip rows that would violate unique(user_id, product_id).
    and not exists (
      select 1 from public.wishlists w2
      where w2.user_id = wishlists.user_id and w2.product_id = p_primary_product_id
    );
  delete from public.wishlists where product_id = p_secondary_product_id;

  update public.price_alerts set product_id = p_primary_product_id, product_variant_id = null
  where product_id = p_secondary_product_id;

  update public.notifications set related_product_id = p_primary_product_id
  where related_product_id = p_secondary_product_id;

  -- Soft-delete the absorbed product; hard delete would cascade away the
  -- variant rows the snapshot references.
  update public.products set is_active = false, updated_at = now()
  where id = p_secondary_product_id;

  insert into public.product_merge_log (
    action, primary_product_id, secondary_product_id, snapshot, performed_by, reason
  )
  values (p_action, p_primary_product_id, p_secondary_product_id, v_snapshot, p_performed_by, p_reason)
  returning id into v_log_id;

  return v_log_id;
end;
$$;

-- ---------------------------------------------------------------------
-- unmerge_products — reverse a merge using its snapshot
-- ---------------------------------------------------------------------
create or replace function public.unmerge_products(
  p_merge_log_id uuid,
  p_performed_by uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_log record;
  v_variant jsonb;
  v_offer_id uuid;
  v_restored_variant_id uuid;
  v_new_log_id uuid;
begin
  select * into v_log from public.product_merge_log where id = p_merge_log_id;
  if v_log is null then
    raise exception 'Merge log % not found', p_merge_log_id;
  end if;
  if v_log.action = 'unmerge' then
    raise exception 'Cannot unmerge an unmerge record';
  end if;
  if exists (
    select 1 from public.product_merge_log
    where secondary_product_id = v_log.secondary_product_id
      and action = 'unmerge' and created_at > v_log.created_at
  ) then
    raise exception 'This merge has already been reversed';
  end if;

  -- Reactivate the absorbed product.
  update public.products set is_active = true, updated_at = now()
  where id = v_log.secondary_product_id;

  -- Restore each snapshotted variant and move its offers back.
  for v_variant in select * from jsonb_array_elements(v_log.snapshot -> 'variants')
  loop
    insert into public.product_variants (id, product_id, label, variant_signature, variant_axes)
    values (
      (v_variant ->> 'variant_id')::uuid,
      v_log.secondary_product_id,
      v_variant ->> 'label',
      coalesce(v_variant ->> 'signature', ''),
      coalesce(v_variant -> 'axes', '{}'::jsonb)
    )
    on conflict (id) do update set is_active = true
    returning id into v_restored_variant_id;

    for v_offer_id in select (jsonb_array_elements_text(v_variant -> 'offer_ids'))::uuid
    loop
      update public.merchant_offers
      set product_variant_id = v_restored_variant_id, updated_at = now()
      where id = v_offer_id;
    end loop;
  end loop;

  insert into public.product_merge_log (
    action, primary_product_id, secondary_product_id, snapshot, performed_by, reason
  )
  values (
    'unmerge', v_log.primary_product_id, v_log.secondary_product_id,
    jsonb_build_object('reversed_log_id', p_merge_log_id), p_performed_by,
    'Reversal of merge ' || p_merge_log_id::text
  )
  returning id into v_new_log_id;

  return v_new_log_id;
end;
$$;

comment on function public.unmerge_products is
  'Reverses a merge from its snapshot. Guards against double-reversal, '
  'which would otherwise resurrect variant rows whose offers have since '
  'moved elsewhere.';

-- ---------------------------------------------------------------------
-- ingest_matched_product — replaces the naive matching in 0010
-- ---------------------------------------------------------------------
-- 0010's ingest_normalized_product did exact-identifier matching inline.
-- Matching is now decided in TypeScript (lib/matching/), so this variant
-- accepts the RESOLVED product/variant identity and just persists it.
--
-- The variant lookup is by SIGNATURE, not label. That single change is
-- what makes "256GB never merges with 512GB" a database-level guarantee:
-- product_variants is UNIQUE on (product_id, variant_signature), so two
-- different signatures cannot occupy the same row even if a caller asks.
create or replace function public.ingest_matched_product(
  p_merchant_id uuid,
  p_external_id text,
  p_title text,
  p_product_url text,
  p_price numeric,
  -- Resolved by the matcher; null means "create a new product".
  p_matched_product_id uuid default null,
  p_product_key text default null,
  p_variant_signature text default '',
  p_variant_axes jsonb default '{}'::jsonb,
  p_variant_label text default null,
  p_match_tier text default null,
  p_match_confidence numeric default null,
  p_currency text default 'INR',
  p_mrp numeric default null,
  p_in_stock boolean default true,
  p_cod_available boolean default false,
  p_brand_name text default null,
  p_category_name text default null,
  p_description text default null,
  p_image_urls text[] default '{}',
  p_gtin text default null,
  p_mpn text default null,
  p_model text default null,
  p_specs jsonb default '{}'::jsonb,
  p_rating numeric default null,
  p_review_count int default null
)
returns table (product_id uuid, variant_id uuid, offer_id uuid, was_created boolean)
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
  v_specs jsonb;
  v_prev_price numeric;
  v_prev_stock boolean;
  v_signature text := coalesce(p_variant_signature, '');
begin
  if p_external_id is null or length(trim(p_external_id)) = 0 then
    raise exception 'external_id is required';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'title is required';
  end if;

  v_specs := coalesce(p_specs, '{}'::jsonb);
  if p_model is not null and length(trim(p_model)) > 0 then
    v_specs := v_specs || jsonb_build_object('Model', trim(p_model));
  end if;

  if p_brand_name is not null and length(trim(p_brand_name)) > 0 then
    insert into public.brands (name, slug)
    values (trim(p_brand_name), public.slugify(p_brand_name))
    on conflict (slug) do update set name = excluded.name
    returning id into v_brand_id;
  end if;

  if p_category_name is not null and length(trim(p_category_name)) > 0 then
    insert into public.categories (name, slug)
    values (trim(p_category_name), public.slugify(p_category_name))
    on conflict (slug) do update set name = excluded.name
    returning id into v_category_id;
  end if;

  -- An existing offer always wins: re-ingesting a known listing must keep
  -- it attached where it already is, regardless of what the matcher said.
  select mo.id, mo.product_variant_id into v_offer_id, v_variant_id
  from public.merchant_offers mo
  where mo.merchant_id = p_merchant_id and mo.external_product_id = p_external_id;

  if v_variant_id is not null then
    select pv.product_id into v_product_id from public.product_variants pv where pv.id = v_variant_id;
  end if;

  if v_product_id is null then
    v_product_id := p_matched_product_id;
  end if;

  if v_product_id is null then
    v_slug := left(public.slugify(p_title), 80) || '-' || lower(left(p_external_id, 12));

    insert into public.products (
      slug, title, brand_id, category_id, description, specs,
      primary_image_url, images, gtin, mpn, model, product_key,
      match_tier, match_confidence
    )
    values (
      v_slug, trim(p_title), v_brand_id, v_category_id, p_description, v_specs,
      coalesce(p_image_urls[1], ''), coalesce(p_image_urls, '{}'),
      nullif(trim(coalesce(p_gtin, '')), ''),
      nullif(trim(coalesce(p_mpn, '')), ''),
      nullif(trim(coalesce(p_model, '')), ''),
      nullif(trim(coalesce(p_product_key, '')), ''),
      p_match_tier, p_match_confidence
    )
    on conflict (slug) do update set
      title = excluded.title,
      description = coalesce(excluded.description, public.products.description),
      updated_at = now()
    returning id into v_product_id;

    v_created := true;
  else
    -- Backfill identifiers we didn't previously have. Never overwrite an
    -- existing identifier with a different one — that would silently
    -- re-point a product's identity based on one merchant's bad data.
    update public.products set
      gtin = coalesce(gtin, nullif(trim(coalesce(p_gtin, '')), '')),
      mpn = coalesce(mpn, nullif(trim(coalesce(p_mpn, '')), '')),
      model = coalesce(model, nullif(trim(coalesce(p_model, '')), '')),
      product_key = coalesce(product_key, nullif(trim(coalesce(p_product_key, '')), '')),
      description = coalesce(description, p_description),
      brand_id = coalesce(brand_id, v_brand_id),
      category_id = coalesce(category_id, v_category_id),
      updated_at = now()
    where id = v_product_id;
  end if;

  -- Variant resolution BY SIGNATURE. This is the enforcement point.
  if v_variant_id is null then
    insert into public.product_variants (product_id, label, variant_signature, variant_axes, attributes)
    values (
      v_product_id,
      coalesce(nullif(trim(coalesce(p_variant_label, '')), ''), 'Standard'),
      v_signature,
      coalesce(p_variant_axes, '{}'::jsonb),
      coalesce(p_variant_axes, '{}'::jsonb)
    )
    on conflict (product_id, variant_signature) do update set
      variant_axes = excluded.variant_axes,
      updated_at = now()
    returning id into v_variant_id;
  end if;

  insert into public.merchant_offers (
    product_variant_id, merchant_id, external_product_id, destination_url, is_active, match_confidence
  )
  values (v_variant_id, p_merchant_id, p_external_id, p_product_url, true, p_match_confidence)
  on conflict (merchant_id, external_product_id) do update set
    destination_url = excluded.destination_url,
    product_variant_id = excluded.product_variant_id,
    is_active = true,
    updated_at = now()
  returning id into v_offer_id;

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

  if v_prev_price is null or v_prev_price <> p_price or v_prev_stock is distinct from p_in_stock then
    insert into public.price_history (merchant_offer_id, price, mrp, in_stock)
    values (v_offer_id, p_price, p_mrp, p_in_stock);
  end if;

  return query select v_product_id, v_variant_id, v_offer_id, v_created;
end;
$$;

comment on function public.ingest_matched_product is
  'The single catalog write path. Accepts an ALREADY-RESOLVED product '
  'identity from lib/matching/ and persists it. Variants are keyed by '
  'signature, backed by a unique index, so differing variants can never '
  'share a row. Supersedes ingest_normalized_product from 0010.';

-- Retire the superseded ingest path from 0010. Leaving both in place would
-- mean two functions that write the catalog with different matching
-- semantics — the older one keys variants by LABEL, which cannot enforce
-- the variant-signature guarantee. One write path only.
drop function if exists public.ingest_normalized_product(
  uuid, text, text, text, numeric, text, numeric, boolean, boolean, text, text,
  text, text[], text, text, text, jsonb, jsonb, numeric, int
);
