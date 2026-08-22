import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/rbac";

export const GET = withErrorHandling(async () => {
  const sessionSupabase = await createClient();
  await requirePermission(sessionSupabase, "manage_connectors");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_merchant_summary");
  if (error) throw error;

  return NextResponse.json({ merchants: data ?? [] });
});
