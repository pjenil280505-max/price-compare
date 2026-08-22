import { Section } from "@/components/layout/Section";
import { Skeleton } from "@/components/ui/Skeleton";

export default function ProductLoading() {
  return (
    <Section>
      <div className="grid gap-10 lg:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-lg" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-48 w-full rounded-lg" />
        </div>
      </div>
      <Skeleton className="mt-14 h-10 w-full max-w-lg" />
      <Skeleton className="mt-6 h-64 w-full rounded-lg" />
    </Section>
  );
}
