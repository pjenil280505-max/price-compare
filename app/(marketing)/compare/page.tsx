import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";
import { api } from "@/lib/api";
import type { Product } from "@/lib/types";
import { getCheapestOffer, getDiscountPercent } from "@/lib/utils";
import { Section } from "@/components/layout/Section";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { PriceBadge, DiscountBadge } from "@/components/badges/PriceBadges";
import { BuyButton } from "@/components/product/BuyButton";

interface ComparePageProps {
  searchParams: Promise<{ ids?: string }>;
}

const ATTRIBUTE_ROWS: { label: string; render: (p: Product) => string }[] = [
  { label: "Brand", render: (p) => p.brand ?? "—" },
  { label: "Category", render: (p) => p.category },
  { label: "Rating", render: (p) => (p.rating != null ? `${p.rating.toFixed(1)} / 5` : "—") },
  { label: "Stores compared", render: (p) => String(p.offers.length) },
  { label: "In stock at", render: (p) => String(p.offers.filter((o) => o.inStock).length) + " stores" },
];

export default async function ComparePage({ searchParams }: ComparePageProps) {
  const { ids: idsParam } = await searchParams;
  const ids = idsParam?.split(",").filter(Boolean) ?? [];

  if (ids.length < 2) {
    return (
      <Section>
        <PageHeader title="Comparison" />
        <EmptyState
          className="mt-8"
          title="Pick at least two products to compare"
          description="Add products from search results or a product page to see them side by side here."
        />
      </Section>
    );
  }

  const products = await api.compare(ids.slice(0, 4));

  return (
    <Section>
      <PageHeader title="Comparison" description={`Comparing ${products.length} products`} />

      <div className="mt-8 overflow-x-auto">
        <div className="grid min-w-[640px] gap-4" style={{ gridTemplateColumns: `repeat(${products.length}, minmax(220px, 1fr))` }}>
          {products.map((product) => {
            const cheapest = getCheapestOffer(product);
            const discount = cheapest ? getDiscountPercent(cheapest) : undefined;
            return (
              <div key={product.id} className="flex flex-col rounded-lg border border-ink-100 p-4 dark:border-ink-800">
                <Link href={`/products/${product.slug}`} className="relative aspect-square overflow-hidden rounded-md bg-ink-50 dark:bg-ink-900">
                  <Image src={product.imageUrl} alt={product.title} fill sizes="25vw" className="object-contain p-4" />
                </Link>
                <Link href={`/products/${product.slug}`} className="mt-3 line-clamp-2 text-sm font-medium text-ink hover:underline dark:text-paper">
                  {product.title}
                </Link>
                {product.rating != null && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-ink-400">
                    <Star className="h-3.5 w-3.5 fill-saffron text-saffron" aria-hidden="true" />
                    {product.rating.toFixed(1)}
                  </div>
                )}
                {cheapest ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <PriceBadge price={cheapest.price} mrp={cheapest.mrp} />
                      {discount != null && discount > 0 && <DiscountBadge percent={discount} />}
                    </div>
                    <BuyButton offer={cheapest} size="sm" fullWidth />
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-ink-400">Unavailable</p>
                )}
              </div>
            );
          })}
        </div>

        <table className="mt-8 min-w-[640px] w-full border-collapse text-sm">
          <caption className="sr-only">Attribute comparison</caption>
          <tbody>
            {ATTRIBUTE_ROWS.map((row) => (
              <tr key={row.label} className="border-b border-ink-100 dark:border-ink-800">
                <th scope="row" className="w-40 py-3 text-left font-medium text-ink-400">
                  {row.label}
                </th>
                {products.map((product) => (
                  <td key={product.id} className="py-3 text-ink dark:text-paper">
                    {row.render(product)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
