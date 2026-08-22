import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import type { Category } from "@/lib/types";

export const GET = withErrorHandling(async () => {
  const supabase = await createClient();

  // Product count per category — a straightforward correlated subquery is
  // fine here since categories are a small, mostly-static table (unlike
  // the product search path, which is why that one got a dedicated
  // SQL function instead).
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug, image_url, products(count)")
    .order("display_order", { ascending: true });

  if (error) throw error;

  const categories: Category[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    imageUrl: row.image_url ?? "",
    productCount: Array.isArray(row.products) ? (row.products[0]?.count ?? 0) : undefined,
  }));

  return NextResponse.json(categories);
});
