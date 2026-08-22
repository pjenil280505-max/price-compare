import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { performSearch, PAGE_SIZE } from "@/lib/server/search";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchCategories, fetchTrending } from "@/lib/server/catalog";
import type { SortOption } from "@/lib/types";
import { Section } from "@/components/layout/Section";
import { PageHeader } from "@/components/layout/PageHeader";
import { CategoryCard } from "@/components/category/CategoryCard";
import { SearchResultsGrid } from "@/components/search/SearchResultsGrid";
import { SearchFiltersBar, SearchFiltersSidebar } from "@/components/search/SearchFiltersBar";
import { InteractiveProductGrid } from "@/components/product/InteractiveProductGrid";
import { cn } from "@/lib/utils";

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    page?: string;
    minPrice?: string;
    maxPrice?: string;
    merchant?: string;
    brand?: string;
    minRating?: string;
    minDiscount?: string;
    inStock?: string;
  }>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const { q } = await searchParams;
  const query = q?.trim();
  return {
    title: query ? `"${query}"` : "Search",
    description: query
      ? `Compare prices for ${query} across every store we track.`
      : "Search and compare prices across every store we track.",
    // Result pages carry no unique indexable content and create infinite
    // crawl surface via filter permutations. Product and category pages are
    // the indexable surface.
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const sp = await searchParams;
  const query = sp.q?.trim() ?? "";

  if (!query) {
    const browseClient = createPublicClient();
    const [categories, trending] = await Promise.all([
      fetchCategories(browseClient),
      fetchTrending(browseClient),
    ]);
    return (
      <Section>
        <PageHeader title="Search" description="Try a product, a brand, or something like “gaming laptop under ₹60,000”." />
        <div className="mt-10">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-400">Browse categories</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map((category) => (
              <CategoryCard key={category.id} category={category} />
            ))}
          </div>
        </div>
        <div className="mt-12">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-400">Trending now</h2>
          <InteractiveProductGrid initialProducts={trending} />
        </div>
      </Section>
    );
  }

  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  const result = await performSearch(supabase, {
    query,
    filters: {
      priceMin: sp.minPrice ? Number(sp.minPrice) : undefined,
      priceMax: sp.maxPrice ? Number(sp.maxPrice) : undefined,
      merchantIds: sp.merchant?.split(",").filter(Boolean) ?? [],
      brands: sp.brand?.split(",").filter(Boolean) ?? [],
      minRating: sp.minRating ? Number(sp.minRating) : undefined,
      minDiscount: sp.minDiscount ? Number(sp.minDiscount) : undefined,
      inStockOnly: sp.inStock === "1",
    },
    sort: sp.sort ? (sp.sort as SortOption) : undefined,
    page,
  });

  const buildPageHref = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (value != null && key !== "page") params.set(key, String(value));
    }
    if (target > 1) params.set("page", String(target));
    return `/search?${params.toString()}`;
  };

  const first = result.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, result.total);

  return (
    <Section>
      <PageHeader
        title={`Results for “${query}”`}
        description={
          result.total > 0
            ? `Showing ${first}–${last} of ${result.total.toLocaleString("en-IN")} products`
            : "No products matched this search"
        }
      />

      {/* Show what the natural-language parser understood, so a wrong
          interpretation is visible rather than silently filtering results. */}
      {result.parsed.hints.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-ink-400">Understood as</span>
          {result.parsed.hints.map((hint) => (
            <span
              key={hint}
              className="rounded-full bg-saffron-50 px-2.5 py-1 text-xs font-medium text-saffron-700 dark:bg-saffron-700/15 dark:text-saffron-300"
            >
              {hint}
            </span>
          ))}
          {result.parsed.text && (
            <span className="rounded-full bg-ink-50 px-2.5 py-1 text-xs text-ink-500 dark:bg-ink-800 dark:text-ink-300">
              matching “{result.parsed.text}”
            </span>
          )}
        </div>
      )}

      <div className="mt-8 lg:grid lg:grid-cols-[240px_1fr] lg:gap-10">
        <Suspense fallback={null}>
          <SearchFiltersSidebar options={result.filterOptions} className="hidden lg:block" />
        </Suspense>

        <div className="min-w-0">
          <Suspense fallback={null}>
            <SearchFiltersBar options={result.filterOptions} resultCount={result.total} className="mb-6" />
          </Suspense>

          <SearchResultsGrid
            items={result.items}
            emptyTitle={`No results for “${query}”`}
            emptyDescription="Try fewer words, check the spelling, or widen your filters."
          />

          {result.totalPages > 1 && (
            <nav aria-label="Search results pages" className="mt-10 flex items-center justify-center gap-2">
              <PageLink href={buildPageHref(page - 1)} disabled={page <= 1} rel="prev">
                Previous
              </PageLink>
              <span className="px-3 text-sm text-ink-500 dark:text-ink-400" aria-current="page">
                Page {page} of {result.totalPages}
              </span>
              <PageLink href={buildPageHref(page + 1)} disabled={page >= result.totalPages} rel="next">
                Next
              </PageLink>
            </nav>
          )}
        </div>
      </div>
    </Section>
  );
}

function PageLink({
  href,
  disabled,
  rel,
  children,
}: {
  href: string;
  disabled: boolean;
  rel?: string;
  children: React.ReactNode;
}) {
  const classes = cn(
    "inline-flex h-10 min-w-[6rem] items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors",
    disabled
      ? "pointer-events-none border-ink-100 text-ink-300 dark:border-ink-800 dark:text-ink-600"
      : "border-ink-200 text-ink hover:border-saffron-300 dark:border-ink-700 dark:text-paper",
  );

  if (disabled) {
    return (
      <span className={classes} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} rel={rel} className={classes}>
      {children}
    </Link>
  );
}
