import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/rbac";

export const GET = withErrorHandling(async (request: Request) => {
  const sessionSupabase = await createClient();
  const identity = await requirePermission(sessionSupabase, "view_dashboard");

  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 7));
  const admin = createAdminClient();

  const [dashRes, topRes] = await Promise.all([
    admin.rpc("get_admin_dashboard", { p_since_days: days }),
    // Click-derived top lists need the analytics permission; an editor sees
    // operational health without commercial performance data.
    identity.permissions.has("view_analytics")
      ? admin.rpc("get_admin_top_lists", { p_since_days: days, p_limit: 10 })
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (dashRes.error) throw dashRes.error;
  if (topRes.error) throw topRes.error;

  return NextResponse.json({
    periodDays: days,
    role: identity.roleName,
    permissions: [...identity.permissions],
    stats: dashRes.data ?? {},
    top: topRes.data ?? null,
  });
});
