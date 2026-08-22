import { Section } from "@/components/layout/Section";
import { Skeleton, SkeletonProductGrid } from "@/components/ui/Skeleton";

export default function DealsLoading() {
  return (
    <Section>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-3 h-5 w-96 max-w-full" />
      <div className="mt-6 flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-8">
        <SkeletonProductGrid count={8} />
      </div>
    </Section>
  );
}
