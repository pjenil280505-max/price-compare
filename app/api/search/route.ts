import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { performSearch, searchRequestSchema } from "@/lib/server/search";

export const POST = withErrorHandling(async (request: Request) => {
  // search_products is the heaviest query in the app and this route is
  // public — limit it both against abuse and against competitors bulk
  // -harvesting the comparison data.
  enforceRateLimit(request, { key: "search", limit: 60, windowMs: 60_000 });

  const body = searchRequestSchema.parse(await request.json());
  const supabase = await createClient();
  const result = await performSearch(supabase, body);
  return NextResponse.json(result);
});
