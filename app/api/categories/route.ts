import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { fetchCategories } from "@/lib/server/catalog";

/**
 * Thin wrapper. The data logic lives in lib/server/catalog.ts so Server
 * Components can call it directly rather than over HTTP — see the note in
 * that file about build-time prerendering.
 */
export const GET = withErrorHandling(async () => {
  const supabase = await createClient();
  return NextResponse.json(await fetchCategories(supabase));
});
