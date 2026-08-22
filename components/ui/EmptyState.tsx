"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { PackageSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { fadeUp, useReducedMotionSafe, withMotionPreference } from "@/lib/motion";
import { Button } from "./Button";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  const reduced = useReducedMotionSafe();

  return (
    <motion.div
      variants={withMotionPreference(fadeUp, reduced)}
      initial="hidden"
      animate="visible"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-ink-200 px-6 py-14 text-center dark:border-ink-700",
        className,
      )}
    >
      <div className="text-ink-300 dark:text-ink-600" aria-hidden="true">
        {icon ?? <PackageSearch className="h-10 w-10" strokeWidth={1.5} />}
      </div>
      <h3 className="text-base font-semibold text-ink dark:text-paper">{title}</h3>
      {description && (
        <p className="max-w-sm text-sm text-ink-500 dark:text-ink-400">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button variant="outline" size="sm" onClick={onAction} className="mt-2">
          {actionLabel}
        </Button>
      )}
    </motion.div>
  );
}
