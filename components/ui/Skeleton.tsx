import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Base shimmer block. Pure CSS animation (see .skeleton
 * in globals.css), so this never needs "use client" and the shimmer is
 * automatically capped by the global prefers-reduced-motion rule.
 */
export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      style={style}
      className={cn("skeleton rounded-md", className)}
    />
  );
}

/** Mimics a ProductCard: image, title lines, price line. */
export function SkeletonProductCard() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink-100 p-3 dark:border-ink-800">
      <Skeleton className="aspect-square w-full rounded-md" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-12 rounded-full" />
      </div>
    </div>
  );
}

/** A row of SkeletonProductCard, matching ProductGrid's column layout. */
export function SkeletonProductGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonProductCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function SkeletonCircle({ size = 40 }: { size?: number }) {
  return <Skeleton className="rounded-full" style={{ width: size, height: size }} />;
}
