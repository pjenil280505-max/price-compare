-- 0019_audit_fixes.sql
--
-- Final audit remediation.
--
-- FOREIGN KEY INDEXES
--
-- Postgres does not automatically index the referencing side of a foreign
-- key. Without one, every DELETE (or key UPDATE) on the parent table must
-- sequentially scan the child table to enforce the constraint. On a
-- catalog of any size that turns "deactivate one product" into a table
-- scan, and it also blocks the parent row for the duration.
--
-- Each index below is justified by both that constraint check and a real
-- query in the application.

-- Deleting a product must check the review queue; the admin UI also lists
-- reviews by candidate product.
create index if not exists product_match_reviews_candidate_idx
  on public.product_match_reviews(candidate_product_id);

-- "Which reviews did this admin decide?" — used by the audit trail, and
-- required when an admin profile is removed.
create index if not exists product_match_reviews_reviewer_idx
  on public.product_match_reviews(reviewed_by)
  where reviewed_by is not null;

-- Removing an admin must check who they granted access to.
create index if not exists admin_users_granted_by_idx
  on public.admin_users(granted_by)
  where granted_by is not null;

-- Merge log lookups by the admin who performed the merge, and the FK check
-- when a profile is deleted.
create index if not exists product_merge_log_performed_by_idx
  on public.product_merge_log(performed_by)
  where performed_by is not null;

-- unmerge_products() looks up by the absorbed product; the FK check runs on
-- every product delete.
create index if not exists product_merge_log_secondary_idx
  on public.product_merge_log(secondary_product_id)
  where secondary_product_id is not null;

-- Notifications reference a product; deleting a product must check them,
-- and the notifications list joins through this column for the slug.
create index if not exists notifications_related_product_idx
  on public.notifications(related_product_id)
  where related_product_id is not null;

comment on index public.notifications_related_product_idx is
  'Required for the FK check on product deletion. Partial because most '
  'notification types carry no product reference, which keeps the index '
  'small.';
