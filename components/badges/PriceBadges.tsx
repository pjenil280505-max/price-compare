"use client";

import { motion } from "framer-motion";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn, formatDiscount, formatPrice } from "@/lib/utils";
import { scaleIn, useReducedMotionSafe, withMotionPreference } from "@/lib/motion";

export interface PriceBadgeProps {
  price: number;
  mrp?: number;
  size?: "sm" | "md" | "lg";
  /** Direction the price just moved, for a brief animated emphasis — omit for a static price. */
  trend?: "up" | "down" | null;
  className?: string;
}

const sizeClasses = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
};

export function PriceBadge({ price, mrp, size = "md", trend, className }: PriceBadgeProps) {
  const reduced = useReducedMotionSafe();

  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <motion.span
        key={price}
        variants={withMotionPreference(scaleIn, reduced)}
        initial="hidden"
        animate="visible"
        className={cn("font-tabular font-semibold text-ink dark:text-paper", sizeClasses[size])}
      >
        {formatPrice(price)}
      </motion.span>
      {mrp && mrp > price && (
        <span className="font-tabular text-sm text-ink-400 line-through">{formatPrice(mrp)}</span>
      )}
      {trend && (
        <span
          className={cn(
            "flex items-center",
            trend === "down" ? "text-jade-600 dark:text-jade-400" : "text-vermilion-600 dark:text-vermilion-400",
          )}
          aria-label={trend === "down" ? "Price dropped" : "Price increased"}
        >
          {trend === "down" ? (
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </span>
      )}
    </span>
  );
}

export interface DiscountBadgeProps {
  percent: number;
  variant?: "pill" | "ribbon";
  className?: string;
}

/**
 * "ribbon" is the platform's signature treatment for a standout discount —
 * a corner price-tag fold, distinct from the generic rounded-pill badge
 * used everywhere else, reserved for the single best offer on a card.
 */
export function DiscountBadge({ percent, variant = "pill", className }: DiscountBadgeProps) {
  const reduced = useReducedMotionSafe();

  if (variant === "ribbon") {
    return (
      <motion.span
        variants={withMotionPreference(scaleIn, reduced)}
        initial="hidden"
        animate="visible"
        className={cn(
          "absolute left-0 top-3 flex items-center gap-1 rounded-r-full bg-vermilion py-1 pl-3 pr-3.5 text-xs font-semibold text-white shadow-sm",
          "before:absolute before:-left-1.5 before:top-full before:h-1.5 before:w-1.5 before:border-l-[6px] before:border-t-[6px] before:border-l-transparent before:border-t-vermilion-700 before:content-['']",
          className,
        )}
      >
        {formatDiscount(percent)}
      </motion.span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-vermilion-50 px-2 py-0.5 text-xs font-semibold text-vermilion-700 dark:bg-vermilion-700/15 dark:text-vermilion-300",
        className,
      )}
    >
      {formatDiscount(percent)}
    </span>
  );
}

export function CheapestBadge({ className }: { className?: string }) {
  const reduced = useReducedMotionSafe();
  return (
    <motion.span
      variants={withMotionPreference(scaleIn, reduced)}
      initial="hidden"
      animate="visible"
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-jade-50 px-2 py-0.5 text-xs font-semibold text-jade-700 dark:bg-jade-700/15 dark:text-jade-300",
        className,
      )}
    >
      Lowest price
    </motion.span>
  );
}
