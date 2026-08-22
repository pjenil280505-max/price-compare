"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Star } from "lucide-react";
import type { Merchant } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";

export interface MerchantLogoProps {
  merchant: Merchant;
  size?: number;
  className?: string;
}

export function MerchantLogo({ merchant, size = 28, className }: MerchantLogoProps) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-ink-100 dark:ring-ink-700",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src={merchant.logoUrl}
        alt={merchant.name}
        fill
        sizes={`${size}px`}
        className="object-contain p-1"
      />
    </span>
  );
}

export interface MerchantCardProps {
  merchant: Merchant;
  isSelected?: boolean;
  onSelect?: (merchant: Merchant) => void;
  className?: string;
}

/** Compact merchant chip used in filter panels and "available at" lists. */
export function MerchantCard({ merchant, isSelected, onSelect, className }: MerchantCardProps) {
  const reduced = useReducedMotionSafe();
  const isInteractive = Boolean(onSelect);

  const content = (
    <>
      <MerchantLogo merchant={merchant} />
      <span className="flex flex-1 flex-col items-start text-left">
        <span className="text-sm font-medium text-ink dark:text-paper">{merchant.name}</span>
        {merchant.trustRating != null && (
          <span className="flex items-center gap-1 text-xs text-ink-400">
            <Star className="h-3 w-3 fill-saffron text-saffron" aria-hidden="true" />
            {merchant.trustRating.toFixed(1)}
          </span>
        )}
      </span>
    </>
  );

  const sharedClasses = cn(
    "flex items-center gap-2.5 rounded-md border px-3 py-2 transition-colors duration-200",
    isSelected
      ? "border-saffron bg-saffron-50 dark:bg-saffron-700/10"
      : "border-ink-100 dark:border-ink-800",
    isInteractive && "hover:border-saffron-300",
    className,
  );

  if (!isInteractive) {
    return <div className={sharedClasses}>{content}</div>;
  }

  return (
    <motion.button
      type="button"
      whileTap={reduced ? undefined : { scale: 0.98 }}
      aria-pressed={isSelected}
      onClick={() => onSelect?.(merchant)}
      className={sharedClasses}
    >
      {content}
    </motion.button>
  );
}
