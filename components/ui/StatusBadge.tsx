import { AlertCircle, CheckCircle2, Circle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "pending" | "error" | "neutral";

export interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
  className?: string;
}

const toneConfig: Record<StatusTone, { classes: string; icon: typeof Circle }> = {
  success: {
    classes: "bg-jade-50 text-jade-700 dark:bg-jade-700/15 dark:text-jade-300",
    icon: CheckCircle2,
  },
  pending: {
    classes: "bg-saffron-50 text-saffron-700 dark:bg-saffron-700/15 dark:text-saffron-300",
    icon: Clock,
  },
  error: {
    classes: "bg-vermilion-50 text-vermilion-700 dark:bg-vermilion-700/15 dark:text-vermilion-300",
    icon: AlertCircle,
  },
  neutral: {
    classes: "bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-300",
    icon: Circle,
  },
};

export function StatusBadge({ label, tone, className }: StatusBadgeProps) {
  const { classes, icon: Icon } = toneConfig[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        classes,
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}
