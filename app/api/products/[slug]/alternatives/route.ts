import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { fetchAlternatives } from "@/lib/server/catalog";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export const GET = withErrorHandling(async (_request: Request, { params }: RouteParams) => {
  const { slug } = await params;
  const supabase = await createClient();
  return NextResponse.json(await fetchAlternatives(supabase, slug));
});
