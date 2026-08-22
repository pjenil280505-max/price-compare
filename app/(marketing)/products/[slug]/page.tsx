import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Star } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchProductPricing } from "@/lib/server/pricing";
import { siteUrl } from "@/lib/seo/site";
import {
  buildBreadcrumbJsonLd,
  buildProductJsonLd,
  serializeJsonLd,
} from "@/lib/seo/structuredData";
import { Section } from "@/components/layout/Section";
import { Tabs } from "@/components/ui/Tabs";
import { MerchantPriceTable } from "@/components/product/MerchantPriceTable";
import { PriceInsights } from "@/components/product/PriceInsights";
import { PriceHistoryChartLazy } from "@/components/product/PriceHistoryChartLazy";
import { ProductBuyBox } from "@/components/product/ProductBuyBox";
import { RecordProductView } from "@/components/product/RecordProductView";
import { InteractiveProductGrid } from "@/components/product/InteractiveProductGrid";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

async function loadProduct(slug: string) {
  try {
    return await api.getProduct(slug);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Revalidate every 5 minutes. Prices change on a sync cadence measured in
 * hours, so serving a cached page for a few minutes costs nothing in
 * accuracy — and every price on the page carries its own verified-at
 * timestamp, so a slightly stale render is still honestly labelled.
 */
export const revalidate = 300;

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) return {};

  const canonical = `/products/${product.slug}`;
  const description =
    product.description?.slice(0, 160) ??
    `Compare prices for ${product.title} across every store we track, with verified price history.`;

  return {
    title: product.title,
    description,
    // One canonical per product prevents variant/query permutations being
    // indexed as duplicates.
    alternates: { canonical },
    openGraph: {
      type: "website",
      title: product.title,
      description,
      url: canonical,
      images: product.imageUrl ? [{ url: product.imageUrl, alt: product.title }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: product.title,
      description,
      images: product.imageUrl ? [product.imageUrl] : undefined,
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) notFound();

  // Public pricing data — cookie-free so this page can stay cacheable.
  const supabase = createPublicClient();
  const [priceHistory, alternatives, pricing] = await Promise.all([
    api.getPriceHistory(product.slug),
    api.getAlternatives(product.slug),
    fetchProductPricing(supabase, product.id),
  ]);

  const tabs = [
    {
      value: "overview",
      label: "Overview",
      content: (
        <p className="max-w-2xl text-ink-600 dark:text-ink-300">
          {product.description ?? "No description available for this product yet."}
        </p>
      ),
    },
    {
      value: "compare",
      label: `Compare offers (${pricing.offers.length})`,
      content: <MerchantPriceTable pricing={pricing} />,
    },
    {
      value: "history",
      label: "Price history",
      content: <PriceHistoryChartLazy data={priceHistory} />,
    },
    {
      value: "details",
      label: "Details",
      content: product.specs ? (
        <dl className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {Object.entries(product.specs).map(([key, value]) => (
            <div key={key} className="flex justify-between border-b border-ink-100 py-2 text-sm dark:border-ink-800">
              <dt className="text-ink-400">{key}</dt>
              <dd className="font-medium text-ink dark:text-paper">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-ink-400">No additional details available.</p>
      ),
    },
  ];

  const site = siteUrl();
  const productJsonLd = buildProductJsonLd({
    product: {
      title: product.title,
      slug: product.slug,
      description: product.description,
      brand: product.brand,
      imageUrls: product.images ?? (product.imageUrl ? [product.imageUrl] : []),
      rating: product.rating,
      reviewCount: product.reviewCount,
    },
    pricing,
    siteUrl: site,
  });

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: site },
    ...(product.category ? [{ name: product.category, url: `${site}/categories` }] : []),
    { name: product.title, url: `${site}/products/${product.slug}` },
  ]);

  return (
    <>
      {/* Structured data. Prices published here are freshness-gated by
          buildProductJsonLd — an expired price is never asserted to a
          search engine as current. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
      <RecordProductView productId={product.id} />
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="relative aspect-square overflow-hidden rounded-lg bg-ink-50 dark:bg-ink-900">
            <Image
              src={product.imageUrl}
              alt={product.title}
              fill
              priority
              sizes="(min-width: 1024px) 45vw, 90vw"
              className="object-contain p-8"
            />
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            {product.brand && (
              <p className="text-sm font-medium uppercase tracking-wide text-ink-400">{product.brand}</p>
            )}
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink dark:text-paper sm:text-3xl">
              {product.title}
            </h1>
            {product.rating != null && (
              <div className="mt-2 flex items-center gap-1.5 text-sm text-ink-500 dark:text-ink-400">
                <Star className="h-4 w-4 fill-saffron text-saffron" aria-hidden="true" />
                <span className="font-medium text-ink dark:text-paper">{product.rating.toFixed(1)}</span>
                {product.reviewCount != null && <span>({product.reviewCount.toLocaleString("en-IN")} reviews)</span>}
              </div>
            )}

            <PriceInsights pricing={pricing} className="mt-6" />

            <div className="mt-4 rounded-lg border border-ink-100 p-5 dark:border-ink-800">
              <ProductBuyBox product={product} />
            </div>
          </div>
        </div>

        <div className="mt-14">
          <Tabs items={tabs} />
        </div>
      </Section>

      {alternatives.length > 0 && (
        <Section reveal className="pt-0">
          <h2 className="mb-6 font-display text-2xl font-semibold text-ink dark:text-paper">
            You might also like
          </h2>
          <InteractiveProductGrid initialProducts={alternatives} />
        </Section>
      )}
    </>
  );
}
