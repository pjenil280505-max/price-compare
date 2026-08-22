import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-free Supabase client for PUBLIC catalog reads.
 *
 * Why this exists: lib/supabase/server.ts reads cookies() to bind the
 * session, and any route that calls cookies() is forced dynamic — which
 * silently defeats `export const revalidate` on pages that only ever read
 * public data.
 *
 * This client runs as `anon`, so Row Level Security applies exactly as it
 * would for a signed-out visitor. It must therefore NEVER be used for
 * user-scoped data (wishlist, alerts, profile) — those need the
 * session-bound client, or they would return nothing and look broken.
 */
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
