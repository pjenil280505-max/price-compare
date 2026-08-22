import { PlannedSection } from "@/components/admin/PlannedSection";

export default function Page() {
  return (
    <PlannedSection
      title="Prices"
      description="Current pricing across every merchant offer."
      whatItWillDo={["Browse offers by freshness, filtering to stale and expired", "Spot merchants whose prices have stopped updating", "Drill into a single offer's price and stock state"]}
      availableNow={{ label: "System health", href: "/admin/health" }}
    />
  );
}
