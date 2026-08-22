"use client";

import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import type { MerchantOffer } from "@/lib/types";
import { cn, formatPrice } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";
import { MerchantLogo } from "@/components/merchant/Merchant";

export interface BuyButtonProps {
  offer: MerchantOffer;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  /** Optional client-side hook (e.g. firing an analytics event) before the browser navigates. */
  onBeforeNavigate?: (offer: MerchantOffer) => void;
  className?: string;
}

const sizeClasses = {
  sm: "h-9 px-3 text-sm gap-2",
  md: "h-11 px-4 text-sm gap-2.5",
  lg: "h-12 px-5 text-base gap-3",
};

export function BuyButton({ offer, size = "md", fullWidth, onBeforeNavigate, className }: BuyButtonProps) {
  const reduced = useReducedMotionSafe();

  if (!offer.inStock) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md bg-ink-100 text-sm font-medium text-ink-400 dark:bg-ink-800 dark:text-ink-500",
          sizeClasses[size],
          fullWidth && "w-full",
          className,
        )}
      >
        Out of stock
      </span>
    );
  }

  return (
    <motion.a
      href={offer.buyUrl}
      target="_blank"
      rel="sponsored noopener noreferrer"
      whileTap={reduced ? undefined : { scale: 0.97 }}
      onClick={() => onBeforeNavigate?.(offer)}
      className={cn(
        "inline-flex items-center justify-center rounded-md bg-ink font-semibold text-paper transition-colors duration-200",
        "hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        "dark:bg-saffron dark:text-ink-950 dark:hover:bg-saffron-500 dark:focus-visible:ring-offset-ink",
        sizeClasses[size],
        fullWidth && "w-full",
        className,
      )}
    >
      <MerchantLogo merchant={offer.merchant} size={size === "sm" ? 18 : 22} />
      <span>Buy on {offer.merchant.name}</span>
      <span className="font-tabular">{formatPrice(offer.price)}</span>
      <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
    </motion.a>
  );
}
