import { Section } from "@/components/layout/Section";
import { Skeleton, SkeletonProductGrid } from "@/components/ui/Skeleton";

export default function SearchLoading() {
  return (
    <Section>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-3 h-5 w-40" />
      <div className="mt-8 lg:grid lg:grid-cols-[240px_1fr] lg:gap-10">
        <div className="mb-6 hidden flex-col gap-6 lg:flex">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
        <div>
          <Skeleton className="mb-6 h-10 w-full max-w-sm" />
          <SkeletonProductGrid count={8} />
        </div>
      </div>
    </Section>
  );
}
