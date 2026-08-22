import { CheckCircle2, LineChart, ShoppingBag } from "lucide-react";
import { fetchCategories, fetchDeals, fetchTrending } from "@/lib/server/catalog";
import { createPublicClient } from "@/lib/supabase/public";
import { Hero } from "@/components/home/Hero";
import { PriceTicker } from "@/components/home/PriceTicker";
import { Section } from "@/components/layout/Section";
import { CategoryCard } from "@/components/category/CategoryCard";
import { InteractiveProductGrid } from "@/components/product/InteractiveProductGrid";

const steps = [
  {
    icon: ShoppingBag,
    title: "Search once",
    description: "One search checks every store we track — no more tab-hopping between apps.",
  },
  {
    icon: LineChart,
    title: "See the real price",
    description: "Price history for every listing, so a \"deal\" has to actually be one.",
  },
  {
    icon: CheckCircle2,
    title: "Buy from the cheapest",
    description: "One tap sends you straight to the lowest verified price, in stock, today.",
  },
];

export default async function HomePage() {
  const supabase = createPublicClient();

  const [categories, trending, deals] = await Promise.all([
    fetchCategories(supabase),
    fetchTrending(supabase),
    fetchDeals(supabase),
  ]);

  return (
    <>
      <Hero quickCategories={categories.slice(0, 6)} />
      <PriceTicker deals={deals.slice(0, 12)} />

      <Section reveal>
        <div className="mb-8 flex items-end justify-between">
          <h2 className="font-display text-2xl font-semibold text-ink dark:text-paper sm:text-3xl">
            Trending now
          </h2>
        </div>
        <InteractiveProductGrid
          initialProducts={trending}
          emptyTitle="Nothing trending yet"
          emptyDescription="Check back soon — we refresh this as prices move."
        />
      </Section>

      <Section reveal className="bg-ink-50/60 dark:bg-ink-900/40">
        <h2 className="mb-8 font-display text-2xl font-semibold text-ink dark:text-paper sm:text-3xl">
          Shop by category
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map((category) => (
            <CategoryCard key={category.id} category={category} />
          ))}
        </div>
      </Section>

      <Section reveal>
        <div className="grid gap-8 sm:grid-cols-3">
          {steps.map((step) => (
            <div key={step.title} className="flex flex-col items-start gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-saffron-50 text-saffron-700 dark:bg-saffron-700/15 dark:text-saffron-300">
                <step.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="text-base font-semibold text-ink dark:text-paper">{step.title}</h3>
              <p className="text-sm text-ink-500 dark:text-ink-400">{step.description}</p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
