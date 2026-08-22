import { PlannedSection } from "@/components/admin/PlannedSection";

export default function Page() {
  return (
    <PlannedSection
      title="Alerts"
      description="Price alerts across all users, in aggregate."
      whatItWillDo={["Count of active alerts and how many are currently at target", "Alert trigger history and delivery outcomes", "Identify products with the most alerts (demand signal)"]}
      availableNow={{ label: "Users", href: "/admin/users" }}
    />
  );
}
