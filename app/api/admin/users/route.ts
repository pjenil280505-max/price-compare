import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/rbac";

/**
 * User overview for support purposes.
 *
 * MINIMAL BY DESIGN. This returns aggregate activity counts and a display
 * name — deliberately NOT email addresses, wishlisted product lists, or
 * browsing history. An admin does not need to read a user's shopping data
 * to operate the platform, and an admin panel that exposes it is a breach
 * waiting for a compromised admin account.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const sessionSupabase = await createClient();
  await requirePermission(sessionSupabase, "view_users");

  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("profiles")
    .select("id, display_name, created_at, wishlists(count), price_alerts(count)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const users = (data ?? []).map((row) => ({
    // A stable short identifier for support conversations, without
    // exposing the full account id in the UI.
    ref: String(row.id).slice(0, 8),
    displayName: (row.display_name as string) ?? null,
    joinedAt: row.created_at,
    wishlistCount: Array.isArray(row.wishlists) ? (row.wishlists[0]?.count ?? 0) : 0,
    alertCount: Array.isArray(row.price_alerts) ? (row.price_alerts[0]?.count ?? 0) : 0,
  }));

  const { count: totalUsers } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });

  return NextResponse.json({ users, totalUsers: totalUsers ?? 0 });
});
