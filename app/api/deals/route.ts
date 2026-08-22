import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { fetchDeals } from "@/lib/server/catalog";

export const GET = withErrorHandling(async (request: Request) => {
  const category = new URL(request.url).searchParams.get("category") ?? undefined;
  const supabase = await createClient();
  return NextResponse.json(await fetchDeals(supabase, category));
});
