import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { fetchPriceHistory } from "@/lib/server/catalog";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export const GET = withErrorHandling(async (request: Request, { params }: RouteParams) => {
  const { slug } = await params;
  const rangeDays = Number(new URL(request.url).searchParams.get("range")) || 90;
  const supabase = await createClient();
  return NextResponse.json(await fetchPriceHistory(supabase, slug, rangeDays));
});
