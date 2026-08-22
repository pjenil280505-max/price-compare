import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/seo/site";

/**
 * Sitemap generated from live catalog data — never hand-maintained.
 *
 * Capped at 40,000 entries: the spec limit is 50,000 URLs / 50MB per file,
 * and exceeding it invalidates the whole sitemap. Beyond this scale the
 * correct move is a sitemap index with paginated child sitemaps, noted
 * below rather than silently truncating in a way nobody notices.
 */
const MAX_URLS = 40_000;

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/categories`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/deals`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/stores`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/assistant`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/about`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/affiliate-disclosure`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/cookies`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/price-disclaimer`, changeFrequency: "yearly", priority: 0.2 },
  ];

  try {
    const supabase = await createClient();

    const [categoriesRes, productsRes] = await Promise.all([
      supabase.from("categories").select("slug, updated_at").limit(500),
      supabase
        .from("products")
        .select("slug, updated_at")
        .eq("is_active", true)
        // Newest first, so if the cap is ever hit the most relevant pages
        // are the ones included.
        .order("updated_at", { ascending: false })
        .limit(MAX_URLS),
    ]);

    const categories: MetadataRoute.Sitemap = (categoriesRes.data ?? []).map((c) => ({
      url: `${base}/categories/${c.slug}`,
      lastModified: c.updated_at ? new Date(c.updated_at as string) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));

    const products: MetadataRoute.Sitemap = (productsRes.data ?? []).map((p) => ({
      url: `${base}/products/${p.slug}`,
      lastModified: p.updated_at ? new Date(p.updated_at as string) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.9,
    }));

    return [...staticEntries, ...categories, ...products];
  } catch {
    // A database hiccup must not produce an empty sitemap, which search
    // engines can read as "everything was removed". Static entries only.
    return staticEntries;
  }
}
