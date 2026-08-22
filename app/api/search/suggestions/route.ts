import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import type { SearchSuggestion } from "@/lib/types";

export const GET = withErrorHandling(async (request: Request) => {
  // Autocomplete fires on nearly every keystroke, so it is the highest-QPS
  // endpoint in the app and the easiest to abuse for catalog enumeration.
  enforceRateLimit(request, { key: "suggestions", limit: 120, windowMs: 60_000 });

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  // Two chars is the shortest prefix where trigram similarity is meaningful;
  // below that every product matches and the result is noise.
  if (query.length < 2) return NextResponse.json<SearchSuggestion[]>([]);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_suggestions", {
    search_query: query.slice(0, 100),
    p_limit: 8,
  });
  if (error) throw error;

  const suggestions: SearchSuggestion[] = (
    (data ?? []) as {
      id: string;
      type: string;
      label: string;
      image_url: string | null;
      subtitle: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    type: row.type as SearchSuggestion["type"],
    label: row.label,
    imageUrl: row.image_url ?? undefined,
    subtitle: row.subtitle ?? undefined,
  }));

  return NextResponse.json(suggestions, {
    // Short shared cache: identical prefixes are typed constantly, and the
    // catalog changes on a sync cadence measured in hours, not seconds.
    headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120" },
  });
});
