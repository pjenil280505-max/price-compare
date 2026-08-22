import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string;
  icon?: ReactNode;
  trend?: { direction: "up" | "down"; label: string };
  className?: string;
}

export function StatCard({ label, value, icon, trend, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-5 shadow-card dark:border-ink-800 dark:bg-ink-900",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink-500 dark:text-ink-400">{label}</span>
        {icon && <span className="text-ink-300 dark:text-ink-600">{icon}</span>}
      </div>
      <span className="font-tabular text-3xl font-semibold text-ink dark:text-paper">{value}</span>
      {trend && (
        <span
          className={cn(
            "text-xs font-medium",
            trend.direction === "up" ? "text-jade-600 dark:text-jade-400" : "text-vermilion-600 dark:text-vermilion-400",
          )}
        >
          {trend.label}
        </span>
      )}
    </div>
  );
}

/** Same shape as StatCard, mid-flight — used in dashboard/admin loading.tsx files. */
export function StatCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink-100 p-5 dark:border-ink-800">
      <div className="skeleton h-4 w-24 rounded" />
      <div className="skeleton h-8 w-16 rounded" />
    </div>
  );
}
