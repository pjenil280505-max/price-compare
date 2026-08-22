import { Construction } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";

/**
 * An honest placeholder for a dashboard section that is navigable but not
 * yet built out.
 *
 * Deliberately explicit about WHAT is missing and WHERE the equivalent
 * capability currently lives, rather than showing an empty chart that
 * looks like a bug or, worse, fabricated numbers.
 */
export function PlannedSection({
  title,
  description,
  whatItWillDo,
  availableNow,
}: {
  title: string;
  description: string;
  whatItWillDo: string[];
  availableNow?: { label: string; href: string };
}) {
  return (
    <>
      <PageHeader title={title} description={description} />

      <div className="mt-8 rounded-lg border border-dashed border-ink-200 bg-paper p-6 dark:border-ink-700 dark:bg-ink-900">
        <div className="flex items-start gap-3">
          <Construction className="mt-0.5 h-5 w-5 shrink-0 text-saffron-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-ink dark:text-paper">Not built yet</p>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              This section is reachable so the navigation is complete, but it has no implementation
              behind it. It is showing you this rather than an empty dashboard that looks broken.
            </p>

            <p className="mt-4 text-sm font-medium text-ink dark:text-paper">Planned:</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink-500 dark:text-ink-400">
              {whatItWillDo.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            {availableNow && (
              <p className="mt-4 text-sm text-ink-500 dark:text-ink-400">
                Available now:{" "}
                <Link href={availableNow.href} className="font-medium text-ink underline underline-offset-4 dark:text-paper">
                  {availableNow.label}
                </Link>
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
