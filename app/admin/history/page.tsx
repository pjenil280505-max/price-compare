import { PlannedSection } from "@/components/admin/PlannedSection";

export default function Page() {
  return (
    <PlannedSection
      title="Price history"
      description="Recorded price movements over time."
      whatItWillDo={["Chart price movement per product or merchant", "List the largest recent drops and rises", "Verify the rollup job is collapsing old raw rows correctly"]}
      availableNow={{ label: "Overview", href: "/admin" }}
    />
  );
}
