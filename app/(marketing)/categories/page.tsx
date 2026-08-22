import { api } from "@/lib/api";
import { Section } from "@/components/layout/Section";
import { PageHeader } from "@/components/layout/PageHeader";
import { CategoryCard } from "@/components/category/CategoryCard";
import { EmptyState } from "@/components/ui/EmptyState";

export const revalidate = 3600;

export const metadata = {
  title: "Categories",
  description: "Browse every product category we track prices for.",
  alternates: { canonical: "/categories" },
};

export default async function CategoriesPage() {
  const categories = await api.getCategories();

  return (
    <Section>
      <PageHeader title="Categories" description="Browse everything we track, organized the way you'd shop it." />

      {categories.length === 0 ? (
        <EmptyState className="mt-10" title="No categories yet" />
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {categories.map((category) => (
            <CategoryCard key={category.id} category={category} />
          ))}
        </div>
      )}
    </Section>
  );
}
