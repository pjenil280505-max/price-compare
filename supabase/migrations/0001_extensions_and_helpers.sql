-- 0001_extensions_and_helpers.sql
-- Extensions and shared helper functions reused across every table below.

-- gen_random_uuid() for primary keys
create extension if not exists pgcrypto;

-- Trigram indexes for fast fuzzy/partial text search (brand names, product
-- titles) — see the "efficient search" notes in docs/DATABASE.md.
create extension if not exists pg_trgm;

-- Embeddings for product matching/alternatives (products.embedding below).
create extension if not exists vector;

-- ---------------------------------------------------------------------
-- updated_at auto-maintenance
-- ---------------------------------------------------------------------
-- Every table with an updated_at column gets this trigger attached
-- individually in its own migration (`create trigger ... before update
-- ... execute function public.set_updated_at()`), rather than relying on
-- application code to remember to set it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Attach as a BEFORE UPDATE trigger on any table with an updated_at '
  'column. is_admin() — the shared RLS helper — is defined in '
  '0002_identity_and_access.sql instead of here, since it depends on the '
  'admin_users table created there; LANGUAGE sql functions are validated '
  'against existing relations at CREATE FUNCTION time.';
