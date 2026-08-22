import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { siteUrl } from "@/lib/seo/site";
import { buildBreadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/structuredData";
import { Section } from "@/components/layout/Section";
import { PageHeader } from "@/components/layout/PageHeader";
import { InteractiveProductGrid } from "@/components/product/InteractiveProductGrid";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
}

export const revalidate = 600;

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const categories = await api.getCategories();
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
  const categories = await api.getCategories();
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const result = await api.search({ query: "", categorySlug: category.slug });

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
        <InteractiveProductGrid
          initialProducts={result.products}
          emptyTitle={`No products in ${category.name} yet`}
        />
      </div>
    </Section>
  );
}
