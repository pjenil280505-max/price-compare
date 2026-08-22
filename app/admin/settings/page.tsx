import { PlannedSection } from "@/components/admin/PlannedSection";

export default function Page() {
  return (
    <PlannedSection
      title="Settings"
      description="Platform configuration."
      whatItWillDo={["Per-merchant price freshness TTL", "Alert trigger cooldown and matching confidence thresholds", "Data retention windows for clicks and price history"]}
      availableNow={{ label: "System health", href: "/admin/health" }}
    />
  );
}
