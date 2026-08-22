import type { MetadataRoute } from "next";
import { NOINDEX_PREFIXES, siteUrl } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          ...NOINDEX_PREFIXES.map((p) => `${p}/`),
          // Search result pages generate unbounded URL permutations from
          // filter combinations. Crawling them wastes budget that should
          // go to product and category pages, and produces near-duplicate
          // thin content.
          "/search",
          "/*?*sort=",
          "/*?*page=",
          "/*?*merchant=",
          "/*?*brand=",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
