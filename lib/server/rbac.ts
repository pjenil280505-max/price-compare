import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { forbidden } from "./errors";
import { requireUser } from "./auth";

/**
 * ROLE-BASED ACCESS CONTROL
 *
 * Until now requireAdmin() only asked "is this user an admin at all", which
 * meant an `editor` could do everything a `superadmin` could through the
 * API. This module closes that gap (SECURITY.md §4.3).
 *
 * Design notes:
 *   - RLS still only distinguishes admin from non-admin. Fine-grained
 *     checks live here, in the API layer, deliberately: encoding a dozen
 *     permissions into RLS policies would make them unreadable and
 *     unauditable, which is worse than the coarse boundary they enforce
 *     well.
 *   - A missing permission is a 403, never a silently-empty result. Empty
 *     results teach operators the system is broken.
 */

export const PERMISSIONS = [
  "view_dashboard",
  "manage_connectors",
  "view_credentials",
  "manage_affiliate",
  "review_matches",
  "merge_products",
  "manage_deals",
  "view_users",
  "manage_users",
  "view_analytics",
  "manage_settings",
  "view_audit_log",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface AdminIdentity {
  user: User;
  roleName: string;
  permissions: Set<Permission>;
  isSuperadmin: boolean;
}

interface AdminRow {
  role_id: string;
  roles: { name: string; permissions: Record<string, boolean> } | null;
}

/**
 * Resolves the caller's role and permissions.
 *
 * The wildcard "*" grants everything — reserved for superadmin, so adding a
 * new permission to the list above doesn't silently lock the owner out of
 * their own system.
 */
export async function resolveAdminIdentity(supabase: SupabaseClient): Promise<AdminIdentity> {
  const user = await requireUser(supabase);

  const { data, error } = await supabase
    .from("admin_users")
    .select("role_id, roles ( name, permissions )")
    .eq("user_id", user.id)
    .limit(1)
    .returns<AdminRow[]>();

  if (error) throw error;

  const row = data?.[0];
  if (!row) throw forbidden("Admin access required");

  const roleName = row.roles?.name ?? "unknown";
  const raw = row.roles?.permissions ?? {};
  const isSuperadmin = raw["*"] === true || roleName === "superadmin";

  const permissions = new Set<Permission>();
  if (isSuperadmin) {
    for (const p of PERMISSIONS) permissions.add(p);
  } else {
    for (const p of PERMISSIONS) {
      if (raw[p] === true) permissions.add(p);
    }
    // Anyone with an admin_users row can at least see the dashboard shell;
    // individual sections are still gated by their own permission.
    permissions.add("view_dashboard");
  }

  return { user, roleName, permissions, isSuperadmin };
}

/** Resolves identity and enforces a specific permission. */
export async function requirePermission(
  supabase: SupabaseClient,
  permission: Permission,
): Promise<AdminIdentity> {
  const identity = await resolveAdminIdentity(supabase);

  if (!identity.permissions.has(permission)) {
    // Names the missing permission so an operator can fix their own role,
    // without revealing anything about other users or data.
    throw forbidden(`This action requires the "${permission}" permission.`);
  }

  return identity;
}

/** Non-throwing check, for conditionally rendering UI affordances. */
export function hasPermission(identity: AdminIdentity, permission: Permission): boolean {
  return identity.permissions.has(permission);
}

/**
 * Which permissions the seeded roles carry. Mirrors the rows inserted in
 * 0002_identity_and_access.sql, extended by 0016 — kept here so the UI can
 * explain a role without another query.
 */
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  superadmin: "Full access, including managing other admins and credentials.",
  admin: "Operate connectors, matching, deals and analytics. Cannot manage admins.",
  editor: "Review product matches and moderate deals only.",
  viewer: "Read-only access to the dashboard and analytics.",
};
