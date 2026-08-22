import type { Metadata } from "next";
import { performSearch } from "@/lib/server/search";
import { fetchCategories } from "@/lib/server/catalog";
import { createPublicClient } from "@/lib/supabase/public";
import { notFound } from "next/navigation";
import { siteUrl } from "@/lib/seo/site";
import { buildBreadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/structuredData";
import { Section } from "@/components/layout/Section";
import { PageHeader } from "@/components/layout/PageHeader";
import { SearchResultsGrid } from "@/components/search/SearchResultsGrid";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
}

export const revalidate = 600;

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const categories = await fetchCategories(createPublicClient());
  const category = categories.find((c) => c.slug === slug);
  if (!category) return { title: "Category" };

  const canonical = `/categories/${category.slug}`;
  const description = `Compare ${category.name.toLowerCase()} prices across every store we track, with verified current prices and price history.`;

  return {
    title: category.name,
    description,
    alternates: { canonical },
    openGraph: { type: "website", title: category.name, description, url: canonical },
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params;
  const categories = await fetchCategories(createPublicClient());
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const result = await performSearch(createPublicClient(), { query: "", categorySlug: category.slug });

  const site = siteUrl();

  return (
    <Section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            buildBreadcrumbJsonLd([
              { name: "Home", url: site },
              { name: "Categories", url: `${site}/categories` },
              { name: category.name, url: `${site}/categories/${category.slug}` },
            ]),
          ),
        }}
      />
      <PageHeader
        title={category.name}
        description={
          category.productCount != null
            ? `${category.productCount.toLocaleString("en-IN")} products tracked`
            : undefined
        }
      />
      <div className="mt-8">
        {/*
          SearchResultsGrid consumes SearchResultItem directly and renders
          the freshness label on every price. InteractiveProductGrid takes
          the older Product shape, which would mean mapping here and losing
          the freshness data — the one thing a price page must not drop.
        */}
        <SearchResultsGrid
          items={result.items}
          emptyTitle={`No products in ${category.name} yet`}
          emptyDescription="Nothing has been imported into this category yet."
        />
      </div>
    </Section>
  );
}
