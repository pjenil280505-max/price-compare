// Build-time guard: if this module is ever transitively imported into a
// Client Component, the build FAILS instead of silently bundling the
// service-role key into browser JavaScript. This is the enforcement
// behind the convention described below — don't remove it.
import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses Row Level Security entirely. This is the
 * equivalent of a database root credential; SUPABASE_SERVICE_ROLE_KEY has
 * no NEXT_PUBLIC_ prefix specifically so Next.js refuses to bundle it into
 * any client-side JavaScript (see .env.local.example and docs/SECURITY.md).
 *
 * Import this ONLY from server-only code (Route Handlers, never a "use
 * client" file, never anything imported by one). Use it for exactly two
 * kinds of operation, both of which a normal user-session client
 * legitimately cannot do:
 *   1. Logging affiliate clicks for anonymous (signed-out) visitors, where
 *      there is no auth.uid() for RLS to key off of.
 *   2. Cross-cutting admin-overview aggregation queries that join across
 *      many operational tables at once, after the route handler has
 *      already verified the caller is an admin via the session client.
 * Every other server-side query should use lib/supabase/server.ts instead,
 * so RLS keeps doing its job.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    // Defense in depth: even if this module were ever imported into a
    // client bundle by mistake, refuse to run rather than leak the key.
    throw new Error("createAdminClient() must never be called in the browser.");
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
