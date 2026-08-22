import { PlannedSection } from "@/components/admin/PlannedSection";

export default function Page() {
  return (
    <PlannedSection
      title="Products"
      description="Browse and curate the ingested catalog."
      whatItWillDo={["Search and filter the full product catalog", "Inspect variants, offers and match confidence per product", "Deactivate a bad listing (never create or edit product content — that would break the no-manual-entry rule)"]}
      availableNow={{ label: "Matching review", href: "/admin/matches" }}
    />
  );
}
