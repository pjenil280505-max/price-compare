import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Section } from "@/components/layout/Section";
import { PageHeader } from "@/components/layout/PageHeader";
import { PriceTicker } from "@/components/home/PriceTicker";
import { DealCard } from "@/components/deals/DealCard";
import { EmptyState } from "@/components/ui/EmptyState";

interface DealsPageProps {
  searchParams: Promise<{ category?: string }>;
}

// Deals move fastest of the cached pages.
export const revalidate = 180;

export const metadata = {
  title: "Deals",
  description: "Real price drops verified against each store's own price history.",
  alternates: { canonical: "/deals" },
};

export default async function DealsPage({ searchParams }: DealsPageProps) {
  const { category: activeCategory } = await searchParams;
  const [deals, categories] = await Promise.all([
    api.getDeals(activeCategory),
    api.getCategories(),
  ]);

  return (
    <>
      <PriceTicker deals={deals} />
      <Section>
        <PageHeader title="Deals" description="Real price drops, verified against each store's own price history — not list-price theatre." />

        <div className="mt-6 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          <Link
            href="/deals"
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              !activeCategory
                ? "border-ink bg-ink text-paper dark:border-saffron dark:bg-saffron dark:text-ink-950"
                : "border-ink-200 text-ink-500 hover:border-saffron-300 dark:border-ink-700 dark:text-ink-300",
            )}
          >
            All
          </Link>
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/deals?category=${category.slug}`}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                activeCategory === category.slug
                  ? "border-ink bg-ink text-paper dark:border-saffron dark:bg-saffron dark:text-ink-950"
                  : "border-ink-200 text-ink-500 hover:border-saffron-300 dark:border-ink-700 dark:text-ink-300",
              )}
            >
              {category.name}
            </Link>
          ))}
        </div>

        {deals.length === 0 ? (
          <EmptyState
            className="mt-10"
            title="No deals right now"
            description="Check back soon — this list updates as prices move."
          />
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {deals.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
