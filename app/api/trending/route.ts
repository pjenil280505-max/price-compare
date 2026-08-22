import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { fetchTrending } from "@/lib/server/catalog";

export const GET = withErrorHandling(async () => {
  const supabase = await createClient();
  return NextResponse.json(await fetchTrending(supabase));
});
