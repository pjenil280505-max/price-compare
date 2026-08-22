import { PlannedSection } from "@/components/admin/PlannedSection";

export default function Page() {
  return (
    <PlannedSection
      title="Analytics"
      description="Traffic, clicks and conversion signals."
      whatItWillDo={["Click trends over time by merchant and product", "Search terms with no results (catalog gaps)", "Attribution rate trend — the earliest signal an affiliate config broke"]}
      availableNow={{ label: "Affiliate config", href: "/admin/affiliate" }}
    />
  );
}
