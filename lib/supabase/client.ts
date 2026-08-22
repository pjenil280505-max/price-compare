import { createBrowserClient } from "@supabase/ssr";

/**
 * Client-side Supabase client, used exclusively for Auth (sign in, sign up,
 * sign out, session state). Data access — products, wishlist, alerts —
 * goes through app/api/* Route Handlers instead, which is what keeps every
 * data query auditable in one place and lets Route Handlers add caching,
 * rate limiting, and response-shape validation that a raw client query
 * can't. See lib/api.ts's module comment for the full rationale.
 *
 * Safe to import into Client Components: only the public URL and anon key
 * are used here, both NEXT_PUBLIC_* by design (see .env.local.example).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
