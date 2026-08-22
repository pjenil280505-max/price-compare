"use client";

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fadeUp, useReducedMotionSafe, withMotionPreference } from "@/lib/motion";
import { Button } from "./Button";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  description = "That didn't load. Check your connection and try again.",
  onRetry,
  className,
}: ErrorStateProps) {
  const reduced = useReducedMotionSafe();

  return (
    <motion.div
      role="alert"
      variants={withMotionPreference(fadeUp, reduced)}
      initial="hidden"
      animate="visible"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-vermilion-100 bg-vermilion-50 px-6 py-14 text-center dark:border-vermilion-700/40 dark:bg-vermilion-700/10",
        className,
      )}
    >
      <AlertTriangle className="h-10 w-10 text-vermilion-500" strokeWidth={1.5} aria-hidden="true" />
      <h3 className="text-base font-semibold text-ink dark:text-paper">{title}</h3>
      <p className="max-w-sm text-sm text-ink-500 dark:text-ink-300">{description}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      )}
    </motion.div>
  );
}
