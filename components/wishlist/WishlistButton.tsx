"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";

export interface WishlistButtonProps {
  isWishlisted: boolean;
  onToggle: () => void | Promise<void>;
  size?: "sm" | "md";
  className?: string;
}

/**
 * The VISUAL size. The touch target is expanded separately below.
 *
 * A 32px control passes WCAG 2.2 AA (24px minimum), but on a product card
 * it sits close to the card's own link — and a thumb that misses opens the
 * product instead of saving it. The `touch-target` class extends the
 * hit area to 44px without changing how the button looks.
 */
const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
};

const iconSizeClasses = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
};

export function WishlistButton({ isWishlisted, onToggle, size = "md", className }: WishlistButtonProps) {
  const reduced = useReducedMotionSafe();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    if (isPending) return;
    setIsPending(true);
    try {
      await onToggle();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <motion.button
      type="button"
      aria-pressed={isWishlisted}
      aria-label={isWishlisted ? "Remove from wishlist" : "Save to wishlist"}
      disabled={isPending}
      onClick={handleClick}
      whileTap={reduced ? undefined : { scale: 0.85 }}
      className={cn(
        "flex items-center justify-center rounded-full bg-paper/90 text-ink-500 shadow-sm backdrop-blur transition-colors duration-200",
        "hover:text-vermilion disabled:opacity-70 dark:bg-ink-900/90 dark:text-ink-300",
        sizeClasses[size],
        // Invisible hit-area expansion — see the note on sizeClasses.
        "touch-target",
        className,
      )}
    >
      <motion.span
        key={isWishlisted ? "filled" : "outline"}
        initial={reduced ? false : { scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={reduced ? { duration: 0.01 } : { type: "spring", stiffness: 400, damping: 15 }}
      >
        <Heart
          className={cn(iconSizeClasses[size], isWishlisted && "fill-vermilion text-vermilion")}
          aria-hidden="true"
        />
      </motion.span>
    </motion.button>
  );
}
