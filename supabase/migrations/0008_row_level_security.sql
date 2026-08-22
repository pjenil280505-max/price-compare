-- 0008_row_level_security.sql
--
-- Authorization strategy, in one place on purpose so it can be reviewed as
-- a whole rather than piecemeal:
--
-- 1. Catalog data (products, product_variants, merchant_offers, prices,
--    price_history, brands, categories, merchants, coupons) is PUBLIC READ,
--    NO CLIENT WRITE — not even for admins. Every write comes from the
--    service-role client used by ingestion connectors and reviewed
--    match-approval endpoints. This is deliberate: a general "admins can
--    edit any product row" policy would be exactly the manual-product-entry
--    backdoor the platform's core requirement rules out. Admins CURATE
--    already-ingested data (approve a match, deactivate a bad listing);
--    they do not hand-author it.
-- 2. User-owned data (profiles, wishlists, price_alerts, notifications) is
--    readable/writable only by the owning user (auth.uid() = user_id).
-- 3. Operational/admin data (roles, admin_users, sync_jobs, sync_logs,
--    product_match_reviews, affiliate_configurations, affiliate_clicks) is
--    readable only by admins (is_admin()), with narrow write exceptions
--    (product_match_reviews status updates; admin_users membership,
--    superadmin-only) documented at each policy below.

-- ---------------------------------------------------------------------
-- is_superadmin() — needed only for admin_users membership changes.
-- ---------------------------------------------------------------------
create or replace function public.is_superadmin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users au
    join public.roles r on r.id = au.role_id
    where au.user_id = auth.uid() and r.name = 'superadmin'
  );
$$;

-- ======================= Catalog: public read only =====================

alter table public.brands enable row level security;
create policy brands_public_read on public.brands for select using (true);

alter table public.categories enable row level security;
create policy categories_public_read on public.categories for select using (true);

alter table public.merchants enable row level security;
create policy merchants_public_read on public.merchants for select using (is_active or public.is_admin());

alter table public.products enable row level security;
create policy products_public_read on public.products for select using (is_active or public.is_admin());

alter table public.product_variants enable row level security;
create policy product_variants_public_read on public.product_variants for select using (is_active or public.is_admin());

alter table public.merchant_offers enable row level security;
create policy merchant_offers_public_read on public.merchant_offers for select using (is_active or public.is_admin());

alter table public.prices enable row level security;
create policy prices_public_read on public.prices for select using (true);

alter table public.price_history enable row level security;
create policy price_history_public_read on public.price_history for select using (true);

alter table public.coupons enable row level security;
create policy coupons_public_read on public.coupons for select using (is_active or public.is_admin());

-- affiliate_configurations: NOT public. Contains commission rates and
-- other merchant-relationship details that have no reason to be exposed
-- to a signed-out visitor, or to a regular signed-in user.
alter table public.affiliate_configurations enable row level security;
create policy affiliate_configurations_admin_read on public.affiliate_configurations for select using (public.is_admin());

-- ================= User-owned: authenticated, own rows only ============

alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select using (auth.uid() = id or public.is_admin());
create policy profiles_update_own on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
-- No insert policy: rows are created exclusively by the handle_new_user()
-- trigger (security definer), never directly by a client.

alter table public.wishlists enable row level security;
create policy wishlists_select_own on public.wishlists for select using (auth.uid() = user_id);
create policy wishlists_insert_own on public.wishlists for insert with check (auth.uid() = user_id);
create policy wishlists_delete_own on public.wishlists for delete using (auth.uid() = user_id);

alter table public.price_alerts enable row level security;
create policy price_alerts_select_own on public.price_alerts for select using (auth.uid() = user_id);
create policy price_alerts_insert_own on public.price_alerts for insert with check (auth.uid() = user_id);
create policy price_alerts_update_own on public.price_alerts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy price_alerts_delete_own on public.price_alerts for delete using (auth.uid() = user_id);

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select using (auth.uid() = user_id);
-- Users may only flip is_read — enforced at the API layer by which columns
-- the update endpoint accepts; RLS here just scopes rows to their owner.
create policy notifications_update_own on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- No insert/delete policy for regular users: notifications are created by
-- the service role (a triggered job, e.g. a price alert firing).

-- ===================== Operational: admin only ==========================

alter table public.roles enable row level security;
create policy roles_admin_read on public.roles for select using (public.is_admin());
-- No write policy at all: role definitions change rarely enough that a
-- migration (or direct service-role access) is the appropriate tool —
-- deliberately not exposed as a self-service admin UI action.

alter table public.admin_users enable row level security;
create policy admin_users_admin_read on public.admin_users for select using (public.is_admin());
create policy admin_users_superadmin_write on public.admin_users for insert with check (public.is_superadmin());
create policy admin_users_superadmin_delete on public.admin_users for delete using (public.is_superadmin());

alter table public.sync_jobs enable row level security;
create policy sync_jobs_admin_read on public.sync_jobs for select using (public.is_admin());

alter table public.sync_logs enable row level security;
create policy sync_logs_admin_read on public.sync_logs for select using (public.is_admin());

alter table public.product_match_reviews enable row level security;
create policy product_match_reviews_admin_read on public.product_match_reviews for select using (public.is_admin());
-- The one write regular admins/editors do through the UI: approve/reject.
create policy product_match_reviews_admin_update on public.product_match_reviews
  for update using (public.is_admin()) with check (public.is_admin());

alter table public.affiliate_clicks enable row level security;
create policy affiliate_clicks_admin_read on public.affiliate_clicks for select using (public.is_admin());
-- No insert policy for authenticated/anon roles: the /go redirect route
-- logs clicks using the service-role client specifically so anonymous
-- visitors (who have no RLS-matching auth.uid()) can still be logged, and
-- so a client can never forge a click against an offer it didn't visit.
