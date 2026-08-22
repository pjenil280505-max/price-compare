"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

/**
 * framer-motion's HTMLMotionProps redefines the onDrag and onAnimation
 * handler families with its own gesture-callback signatures, which conflict
 * with React's native DOM event types of the same name. Omitting them here
 * is what lets `...props` spread cleanly onto `motion.button` below without
 * a type error — none of them are needed for a plain button anyway.
 */
type OmittedForMotion =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, OmittedForMotion> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-paper hover:bg-ink-800 dark:bg-saffron dark:text-ink-950 dark:hover:bg-saffron-500",
  secondary: "bg-saffron text-ink-950 hover:bg-saffron-500",
  ghost: "bg-transparent text-ink dark:text-paper hover:bg-ink-100 dark:hover:bg-ink-800",
  outline:
    "bg-transparent border border-ink-200 dark:border-ink-700 text-ink dark:text-paper hover:bg-ink-50 dark:hover:bg-ink-800",
  danger: "bg-vermilion text-white hover:bg-vermilion-600",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
  icon: "h-10 w-10 p-0 justify-center",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const reduced = useReducedMotionSafe();

    return (
      <motion.button
        ref={ref}
        whileTap={reduced || disabled || isLoading ? undefined : { scale: 0.97 }}
        transition={{ duration: 0.12 }}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        className={cn(
          "inline-flex items-center rounded-md font-medium transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron focus-visible:ring-offset-2 focus-visible:ring-offset-paper dark:focus-visible:ring-offset-ink",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {isLoading ? (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          leftIcon
        )}
        {children && <span>{children}</span>}
        {!isLoading && rightIcon}
      </motion.button>
    );
  },
);

Button.displayName = "Button";
