import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side Supabase client bound to the current request's cookies.
 * Every query made with this client runs AS the signed-in user (or as
 * anon, if signed out) — Row Level Security applies exactly as it would
 * for a direct client call. This is what Route Handlers should use for
 * anything scoped to "the current user" (wishlist, alerts, profile).
 *
 * cookies() is async as of Next.js 15 — this factory is async to match.
 * setAll() is a no-op-if-it-throws by design: Server Components are
 * allowed to *read* cookies but not write them, so a session-refresh
 * write attempted from a Server Component is silently ignored there;
 * middleware.ts is what actually keeps the session cookie fresh.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component — cookies can't be written
            // here. middleware.ts refreshes the session cookie instead.
          }
        },
      },
    },
  );
}
