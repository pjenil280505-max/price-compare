import { PlannedSection } from "@/components/admin/PlannedSection";

export default function Page() {
  return (
    <PlannedSection
      title="Deals"
      description="Coupons and promotional offers."
      whatItWillDo={["Review coupons ingested from authorized feeds before they go live", "Hide expired or invalid deals", "Nothing here creates a deal by hand — deals come only from merchant feeds"]}
      
    />
  );
}
