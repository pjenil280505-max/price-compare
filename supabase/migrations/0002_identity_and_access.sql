-- 0002_identity_and_access.sql
-- Users, roles, and admin access. Supabase already manages auth.users
-- (email, password hash, sessions) — we never duplicate that. `profiles`
-- extends it 1:1 with app-specific fields.

-- ---------------------------------------------------------------------
-- roles
-- ---------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  -- Coarse-grained capability flags, e.g. {"manage_connectors": true,
  -- "review_matches": true, "manage_users": false}. Route handlers check
  -- specific keys; RLS only ever checks "is this user an admin at all"
  -- via is_admin() below — fine-grained checks happen in the API layer,
  -- not in RLS, to keep policies simple and auditable.
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Reference data, not "fake production data" — every install needs these
-- three rows to exist before any admin can be granted a role.
insert into public.roles (name, description, permissions) values
  ('superadmin', 'Full access, including managing other admins', '{"*": true}'),
  ('admin', 'Manage connectors, matches, deals, and analytics', '{"manage_connectors": true, "review_matches": true, "manage_deals": true}'),
  ('editor', 'Review product matches and moderate deals only', '{"review_matches": true, "manage_deals": true}');

-- ---------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  phone text,
  notify_email boolean not null default true,
  notify_push boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row the moment someone signs up, so the app never
-- has to handle "authenticated user with no profile" as a state.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- admin_users
-- ---------------------------------------------------------------------
create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id)
);

create index admin_users_role_id_idx on public.admin_users(role_id);

-- ---------------------------------------------------------------------
-- is_admin() — now safe to define; admin_users exists above.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  );
$$;

comment on function public.is_admin() is
  'True if the currently authenticated user has any row in admin_users. '
  'Used by RLS policies on admin-only tables. Route handlers that need to '
  'know *which* role/permissions should query admin_users + roles '
  'directly instead of relying on this boolean.';
