import { PlannedSection } from "@/components/admin/PlannedSection";

export default function Page() {
  return (
    <PlannedSection
      title="SEO"
      description="Search engine visibility."
      whatItWillDo={["Sitemap generation status and last submission", "Products missing images, descriptions or structured data", "Indexable page count vs total catalog"]}
      
    />
  );
}
