"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Shared admin building blocks, designed for a phone first.
 *
 * The key decision: NO wide tables. A 6-column table on a 390px screen
 * either overflows horizontally (unusable one-handed) or truncates to
 * uselessness. These render as stacked cards on mobile and only become
 * tabular at lg — which is also better for screen readers, since each card
 * carries its own labels.
 */

export function AdminSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-8 first:mt-0", className)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">{title}</h2>
          {description && <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Compact metric tile. Sized so four fit legibly in a 2×2 grid on a phone,
 * rather than the taller StatCard used on the customer dashboard.
 */
export function MetricTile({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  href?: string;
}) {
  const toneClasses = {
    neutral: "text-ink dark:text-paper",
    good: "text-jade-600 dark:text-jade-400",
    warn: "text-saffron-700 dark:text-saffron-300",
    bad: "text-vermilion-600 dark:text-vermilion-400",
  }[tone];

  const body = (
    <>
      <p className="text-xs text-ink-400">{label}</p>
      <p className={cn("mt-1 font-tabular text-2xl font-semibold tabular-nums", toneClasses)}>
        {typeof value === "number" ? value.toLocaleString("en-IN") : value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-400">{hint}</p>}
    </>
  );

  const classes =
    "rounded-lg border border-ink-100 bg-paper p-4 dark:border-ink-800 dark:bg-ink-900";

  if (href) {
    return (
      <a href={href} className={cn(classes, "block transition-colors hover:border-saffron-300")}>
        {body}
      </a>
    );
  }
  return <div className={classes}>{body}</div>;
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

/**
 * A record rendered as a card. `fields` become a labelled definition list,
 * which reads correctly at any width and to a screen reader.
 */
export function AdminRecordCard({
  title,
  subtitle,
  badge,
  fields,
  actions,
  warning,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  fields?: { label: string; value: ReactNode }[];
  actions?: ReactNode;
  warning?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="rounded-lg border border-ink-100 bg-paper p-4 dark:border-ink-800 dark:bg-ink-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink dark:text-paper">{title}</span>
            {badge}
          </div>
          {subtitle && <p className="mt-1 text-sm text-ink-400">{subtitle}</p>}
        </div>
      </div>

      {fields && fields.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          {fields.map((field) => (
            <div key={field.label}>
              <dt className="text-[11px] uppercase tracking-wide text-ink-400">{field.label}</dt>
              <dd className="mt-0.5 text-sm text-ink dark:text-paper">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {children && <div className="mt-3">{children}</div>}

      {warning && (
        <p className="mt-3 rounded-md bg-vermilion-50 px-3 py-2 text-sm text-vermilion-700 dark:bg-vermilion-700/10 dark:text-vermilion-300">
          {warning}
        </p>
      )}

      {actions && (
        // Actions wrap onto their own row and stay full-height for thumb
        // reach rather than being squeezed beside the title on mobile.
        <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </li>
  );
}

export function AdminList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-3">{children}</ul>;
}

export function AdminListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** Explains a section that has no data yet, without looking broken. */
export function AdminNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <p
      className={cn(
        "rounded-lg border p-4 text-sm",
        tone === "warn"
          ? "border-saffron-300 bg-saffron-50 text-ink-700 dark:border-saffron-700/40 dark:bg-saffron-700/10 dark:text-ink-200"
          : "border-ink-100 bg-paper text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400",
      )}
    >
      {children}
    </p>
  );
}
