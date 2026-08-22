// Reads INTERNAL_CRON_SECRET (assertInternalRequest below) — must never
// reach a client bundle. See lib/supabase/admin.ts for the same guard.
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { forbidden, unauthorized } from "./errors";

/** Returns the signed-in user or throws a 401 — use at the top of any route that requires auth. */
export async function requireUser(supabase: SupabaseClient): Promise<User> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) throw unauthorized();
  return user;
}

/**
 * Confirms the signed-in user has an admin_users row and throws a 403 if
 * not. Callers still get real protection from RLS even if this check were
 * ever skipped by a bug — this exists so admin routes fail fast with a
 * clear error instead of quietly returning empty results.
 */
export async function requireAdmin(supabase: SupabaseClient): Promise<User> {
  const user = await requireUser(supabase);

  const { data, error } = await supabase
    .from("admin_users")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) throw forbidden("Admin access required");

  return user;
}

/**
 * For internal/scheduled endpoints (not called from the browser at all —
 * e.g. a future cron-triggered notification sender). Checks a shared
 * secret header instead of a user session. See .env.local.example's
 * INTERNAL_CRON_SECRET.
 */
export function assertInternalRequest(request: Request): void {
  const provided = request.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_CRON_SECRET;

  if (!expected || !provided || provided !== expected) {
    throw unauthorized("Invalid or missing internal secret");
  }
}
